<?php
/**
 * Passkeys (WebAuthn) prüfen – ohne Bibliothek. Nur was WMap braucht:
 * Registrierung ohne Attestierung („none“) und Anmeldung mit Signatur.
 * Schlüssel: ES256 (P-256) und RS256.
 *
 *   webauthn_register($clientDataJSON, $attestationObject, $challenge, $origin, $rpId)
 *       → [0, ["id" => credId(base64url), "public_key" => PEM, "sign_count" => n]] | [1, Meldung]
 *   webauthn_login($clientDataJSON, $authenticatorData, $signature, $challenge, $origin, $rpId, $pem, $count)
 *       → [0, neuer sign_count] | [1, Meldung]
 */

function b64url_encode($bin){ return rtrim(strtr(base64_encode($bin), '+/', '-_'), '='); }
function b64url_decode($txt){ return base64_decode(strtr($txt, '-_', '+/').str_repeat('=', (4 - strlen($txt) % 4) % 4)); }

/* ── CBOR lesen (RFC 8949, so viel wie nötig) ─────────────────────────────── */

function cbor_decode($bin, &$pos = 0){
    $first = ord($bin[$pos++]);
    $major = $first >> 5;
    $info = $first & 0x1f;
    $len = cbor_length($bin, $pos, $info);
    switch ($major) {
        case 0: return $len;                                   // positive Zahl
        case 1: return -1 - $len;                              // negative Zahl
        case 2: $v = substr($bin, $pos, $len); $pos += $len; return $v;   // Bytes
        case 3: $v = substr($bin, $pos, $len); $pos += $len; return $v;   // Text
        case 4: $a = []; for ($i = 0; $i < $len; $i++) $a[] = cbor_decode($bin, $pos); return $a;
        case 5: $m = []; for ($i = 0; $i < $len; $i++) { $k = cbor_decode($bin, $pos); $m[$k] = cbor_decode($bin, $pos); } return $m;
        case 6: return cbor_decode($bin, $pos);               // Tag: Inhalt
        case 7:
            if ($info == 20) return false;
            if ($info == 21) return true;
            if ($info == 22 || $info == 23) return null;
            return $len;
    }
    throw new Exception("CBOR: unbekannter Typ");
}

function cbor_length($bin, &$pos, $info){
    if ($info < 24) return $info;
    $bytes = [24 => 1, 25 => 2, 26 => 4, 27 => 8][$info] ?? 0;
    if (!$bytes) throw new Exception("CBOR: Länge ohne Angabe wird nicht unterstützt");
    $v = 0;
    for ($i = 0; $i < $bytes; $i++) $v = ($v << 8) | ord($bin[$pos++]);
    return $v;
}

/* ── Schlüssel: COSE → PEM ────────────────────────────────────────────────── */

function der_len($n){
    if ($n < 128) return chr($n);
    $b = ltrim(pack('N', $n), "\0");
    return chr(0x80 | strlen($b)).$b;
}
function der_int($bin){
    $bin = ltrim($bin, "\0");
    if ($bin === '' || ord($bin[0]) & 0x80) $bin = "\0".$bin;
    return "\x02".der_len(strlen($bin)).$bin;
}

function cose_to_pem($cose){
    $kty = $cose[1] ?? null;
    if ($kty === 2) {                                       // EC2, P-256
        if (($cose[-1] ?? null) !== 1) throw new Exception("Nur P-256 wird unterstützt");
        $der = hex2bin('3059301306072a8648ce3d020106082a8648ce3d030107034200').chr(4).$cose[-2].$cose[-3];
    } elseif ($kty === 3) {                                 // RSA
        $rsa = "\x30".der_len(strlen(der_int($cose[-1]).der_int($cose[-2]))).der_int($cose[-1]).der_int($cose[-2]);
        $bits = "\x03".der_len(strlen($rsa) + 1)."\0".$rsa;
        $alg = hex2bin('300d06092a864886f70d0101010500');
        $der = "\x30".der_len(strlen($alg.$bits)).$alg.$bits;
    } else {
        throw new Exception("Schlüsseltyp wird nicht unterstützt");
    }
    return "-----BEGIN PUBLIC KEY-----\n".chunk_split(base64_encode($der), 64, "\n")."-----END PUBLIC KEY-----\n";
}

/* ── Gemeinsam: clientData und authenticatorData prüfen ───────────────────── */

function webauthn_client($clientDataJSON, $type, $challenge, $origin){
    $c = json_decode($clientDataJSON, true);
    if (!$c || ($c["type"] ?? "") !== $type)                     return "Falsche Art der Anfrage";
    if (!hash_equals($challenge, $c["challenge"] ?? ""))         return "Die Anfrage ist abgelaufen – bitte noch einmal";
    if (($c["origin"] ?? "") !== $origin)                        return "Falsche Herkunft (".($c["origin"] ?? "?").")";
    return null;
}

function webauthn_auth_data($auth, $rpId){
    if (strlen($auth) < 37)                                      return [null, "Antwort unvollständig"];
    if (!hash_equals(hash('sha256', $rpId, true), substr($auth, 0, 32))) return [null, "Falsche Domain"];
    $flags = ord($auth[32]);
    if (!($flags & 0x01))                                        return [null, "Passkey wurde nicht bestätigt"];
    return [["flags" => $flags, "count" => unpack('N', substr($auth, 33, 4))[1]], null];
}

/* ── Registrierung ────────────────────────────────────────────────────────── */

function webauthn_register($clientDataJSON, $attestationObject, $challenge, $origin, $rpId){
    try {
        $err = webauthn_client($clientDataJSON, "webauthn.create", $challenge, $origin);
        if ($err) return [1, $err];
        $att = cbor_decode($attestationObject);
        $auth = $att["authData"] ?? "";
        [$info, $err] = webauthn_auth_data($auth, $rpId);
        if ($err) return [1, $err];
        if (!($info["flags"] & 0x40))                            return [1, "Kein Schlüssel in der Antwort"];
        $pos = 37 + 16;                                          // AAGUID überspringen
        $idLen = unpack('n', substr($auth, $pos, 2))[1];
        $pos += 2;
        $credId = substr($auth, $pos, $idLen);
        $pos += $idLen;
        $cose = cbor_decode($auth, $pos);
        return [0, ["id" => b64url_encode($credId), "public_key" => cose_to_pem($cose), "sign_count" => $info["count"]]];
    } catch (Exception $e) {
        return [1, "Passkey nicht lesbar: ".$e->getMessage()];
    }
}

/* ── Anmeldung ────────────────────────────────────────────────────────────── */

function webauthn_login($clientDataJSON, $authenticatorData, $signature, $challenge, $origin, $rpId, $pem, $count){
    $err = webauthn_client($clientDataJSON, "webauthn.get", $challenge, $origin);
    if ($err) return [1, $err];
    [$info, $err] = webauthn_auth_data($authenticatorData, $rpId);
    if ($err) return [1, $err];
    $data = $authenticatorData.hash('sha256', $clientDataJSON, true);
    if (openssl_verify($data, $signature, $pem, OPENSSL_ALGO_SHA256) !== 1) return [1, "Unterschrift passt nicht"];
    // Zähler muss steigen (0 heißt: Gerät zählt nicht mit)
    if ($info["count"] > 0 && $info["count"] <= $count)         return [1, "Passkey wurde kopiert? Zähler passt nicht"];
    return [0, $info["count"]];
}
?>
