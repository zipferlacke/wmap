// Copyright 2019-2023 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

use serde::{Serialize, de::DeserializeOwned};
use tauri::{
    AppHandle, Runtime,
    ipc::{Channel, InvokeResponseBody},
    plugin::{PluginApi, PluginHandle},
};

use crate::models::*;

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "app.tauri.geolocation";

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_geolocation);

// initializes the Kotlin or Swift plugin classes
pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> crate::Result<Geolocation<R>> {
    #[cfg(target_os = "android")]
    let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "GeolocationPlugin")?;
    #[cfg(target_os = "ios")]
    let handle = api.register_ios_plugin(init_plugin_geolocation)?;
    Ok(Geolocation(handle))
}

/// Access to the geolocation APIs.
pub struct Geolocation<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> Geolocation<R> {
    /// Returns the device's current [`Position`]. On Android this returns the last known location immediately if it is still within `maximum_age`, otherwise it requests a fresh reading. Errors if location services are disabled or the required permission was not granted.
    pub fn get_current_position(
        &self,
        options: Option<PositionOptions>,
    ) -> crate::Result<Position> {
        // TODO: We may have to send over None if that's better on Android
        self.0
            .run_mobile_plugin("getCurrentPosition", options.unwrap_or_default())
            .map_err(Into::into)
    }

    /// Register a position watcher. This method returns an id to use in `clear_watch`.
    pub fn watch_position<F: Fn(WatchEvent) + Send + Sync + 'static>(
        &self,
        options: PositionOptions,
        callback: F,
    ) -> crate::Result<u32> {
        let channel = Channel::new(move |event| {
            let payload = match event {
                InvokeResponseBody::Json(payload) => serde_json::from_str::<WatchEvent>(&payload)
                    .unwrap_or_else(|error| {
                        WatchEvent::Error(format!(
                            "Couldn't deserialize watch event payload: `{error}`"
                        ))
                    }),
                _ => WatchEvent::Error("Unexpected watch event payload.".to_string()),
            };

            callback(payload);

            Ok(())
        });
        let id = channel.id();

        self.watch_position_inner(options, channel)?;

        Ok(id)
    }

    pub(crate) fn watch_position_inner(
        &self,
        options: PositionOptions,
        channel: Channel,
    ) -> crate::Result<()> {
        self.0
            .run_mobile_plugin("watchPosition", WatchPayload { options, channel })
            .map_err(Into::into)
    }

    /// Removes the position watcher registered with the given `channel_id`, as returned by [`Self::watch_position`]. Stops the platform location updates once no watcher remains.
    pub fn clear_watch(&self, channel_id: u32) -> crate::Result<()> {
        self.0
            .run_mobile_plugin("clearWatch", ClearWatchPayload { channel_id })
            .map_err(Into::into)
    }

    /// Returns the current [`PermissionStatus`] for the geolocation APIs. Errors if location services are disabled on the device.
    pub fn check_permissions(&self) -> crate::Result<PermissionStatus> {
        self.0
            .run_mobile_plugin("checkPermissions", ())
            .map_err(Into::into)
    }

    /// Requests the given `permissions` (or all of them when `None`) and returns the resulting [`PermissionStatus`]. Errors if location services are disabled on the device.
    pub fn request_permissions(
        &self,
        permissions: Option<Vec<PermissionType>>,
    ) -> crate::Result<PermissionStatus> {
        self.0
            .run_mobile_plugin(
                "requestPermissions",
                serde_json::json!({ "permissions": permissions }),
            )
            .map_err(Into::into)
    }

    /// WMap: Vordergrund-Dienst starten, der den Standort sammelt, solange die App nicht zu sehen ist (nur Android).
    pub fn start_recording(&self) -> crate::Result<()> {
        #[cfg(target_os = "android")]
        return self.0.run_mobile_plugin("startRecording", ()).map_err(Into::into);
        #[cfg(not(target_os = "android"))]
        Err(crate::Error::Unavailable)
    }

    /// WMap: Dienst beenden, Gesammeltes verwerfen.
    pub fn stop_recording(&self) -> crate::Result<()> {
        #[cfg(target_os = "android")]
        return self.0.run_mobile_plugin("stopRecording", ()).map_err(Into::into);
        #[cfg(not(target_os = "android"))]
        Ok(())
    }

    /// WMap: Gesammelte Punkte abholen – `{ points: [[lon, lat, Genauigkeit, Zeit]], running }`.
    pub fn take_recorded(&self) -> crate::Result<serde_json::Value> {
        #[cfg(target_os = "android")]
        return self.0.run_mobile_plugin("takeRecorded", ()).map_err(Into::into);
        #[cfg(not(target_os = "android"))]
        Ok(serde_json::json!({ "points": [], "running": false }))
    }

    /// WMap: Freigabe für Benachrichtigungen – `{ state: "granted" | "prompt" }` (`notificationState` fragt
    /// nur ab, `requestNotification` zeigt das Fenster von Android).
    pub fn notification(&self, _command: &str) -> crate::Result<serde_json::Value> {
        #[cfg(target_os = "android")]
        return self.0.run_mobile_plugin(_command, ()).map_err(Into::into);
        #[cfg(not(target_os = "android"))]
        Ok(serde_json::json!({ "state": "granted" }))
    }
}

#[derive(Serialize)]
struct WatchPayload {
    options: PositionOptions,
    channel: Channel,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ClearWatchPayload {
    channel_id: u32,
}
