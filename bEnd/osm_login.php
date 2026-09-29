<?php
/**
 * Anmelden mit dem OpenStreetMap-Konto (OpenID Connect) – ohne Bibliothek.
 * WMap meldet sich im Browser/in der App bei OSM an (OAuth 2 mit PKCE, Recht
 * „openid“) und schickt das id_token hierher. Geprüft wird es mit den
 * öffentlichen Schlüsseln von OSM: Signatur (RS256), Aussteller, für welche
 * Anwendung (aud = OSM_CLIENT_ID) und Ablauf. Ein Geheimnis braucht dafür
 * niemand – weder die App noch der Server.
 *   osm_id_token($jwt) → [0, Angaben (sub = OSM-Nutzer-ID, preferred_username)] | [1, Meldung]
 * Die Schlüssel liegen zwischengespeichert in data/osm-jwks.json.
 */

function b64url_encode($bin){ return rtrim(strtr(base64_encode($bin), '+/', '-_'), '='); }
function b64url_decode($txt){ return base64_decode(strtr($txt, '-_', '+/').str_repeat('=', (4 - strlen($txt) % 4) % 4)); }

function osm_id_token($jwt){
    $parts = explode('.', (string)$jwt);
    if (count($parts) !== 3)                                        return [1, "Anmeldung ungültig – bitte noch einmal"];
    [$h64, $p64, $s64] = $parts;
    $head = json_decode(b64url_decode($h64), true);
    $claims = json_decode(b64url_decode($p64), true);
    if (!is_array($head) || !is_array($claims))                     return [1, "Anmeldung ungültig – bitte noch einmal"];
    if (($head["alg"] ?? "") !== "RS256")                           return [1, "Anmeldung ungültig (Verfahren)"];
    $pem = osm_key($head["kid"] ?? "");
    if (!$pem)                                                      return [1, "OpenStreetMap ist gerade nicht erreichbar – bitte später noch einmal"];
    if (openssl_verify("$h64.$p64", b64url_decode($s64), $pem, OPENSSL_ALGO_SHA256) !== 1)
                                                                    return [1, "Anmeldung ungültig (Signatur)"];
    if (($claims["iss"] ?? "") !== OSM_ISSUER)                      return [1, "Das WMap-Konto geht nur mit einem Konto bei openstreetmap.org"];
    if (!in_array(OSM_CLIENT_ID, (array)($claims["aud"] ?? []), true))
                                                                    return [1, "Anmeldung über eine fremde Anwendung – bitte in WMap anmelden"];
    if ((int)($claims["exp"] ?? 0) < time() - 60)                   return [1, "Anmeldung abgelaufen – bitte noch einmal"];
    if (!ctype_digit((string)($claims["sub"] ?? "")))               return [1, "Anmeldung ungültig (Nutzer)"];
    return [0, $claims];
}

/** Öffentlicher Schlüssel von OSM als PEM – aus dem Zwischenspeicher, sonst frisch geholt */
function osm_key($kid){
    $file = __DIR__."/data/osm-jwks.json";
    $cache = json_decode(@file_get_contents($file) ?: "{}", true) ?: [];
    $find = function($keys) use ($kid){
        foreach ($keys ?? [] as $k) if (($k["kid"] ?? "") === $kid && ($k["kty"] ?? "") === "RSA") return jwk_to_pem($k);
        return null;
    };
    $fresh = time() - ($cache["time"] ?? 0) < 7 * 86400;
    if ($fresh && ($pem = $find($cache["keys"] ?? []))) return $pem;
    // Unbekannter Schlüssel: höchstens alle 5 Minuten nachfragen
    if (time() - ($cache["time"] ?? 0) < 300) return null;
    $ctx = stream_context_create(["http" => ["timeout" => 8, "header" => "User-Agent: WMap\r\n"]]);
    $got = json_decode(@file_get_contents(OSM_ISSUER."/oauth2/discovery/keys", false, $ctx) ?: "", true);
    if (!isset($got["keys"])) return null;
    @file_put_contents($file, json_encode(["time" => time(), "keys" => $got["keys"]]));
    return $find($got["keys"]);
}

/* ── Schlüssel: JWK (n, e) → PEM ──────────────────────────────────────────── */

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
function jwk_to_pem($k){
    $ints = der_int(b64url_decode($k["n"] ?? "")).der_int(b64url_decode($k["e"] ?? ""));
    $rsa = "\x30".der_len(strlen($ints)).$ints;
    $bits = "\x03".der_len(strlen($rsa) + 1)."\0".$rsa;
    $alg = hex2bin('300d06092a864886f70d0101010500');
    $der = "\x30".der_len(strlen($alg.$bits)).$alg.$bits;
    return "-----BEGIN PUBLIC KEY-----\n".chunk_split(base64_encode($der), 64, "\n")."-----END PUBLIC KEY-----\n";
}
?>
