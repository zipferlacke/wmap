// Copyright 2019-2023 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

use tauri::{AppHandle, Runtime, command, ipc::Channel};

use crate::{GeolocationExt, PermissionStatus, PermissionType, Position, PositionOptions, Result};

#[command]
pub(crate) async fn get_current_position<R: Runtime>(
    app: AppHandle<R>,
    options: Option<PositionOptions>,
) -> Result<Position> {
    app.geolocation().get_current_position(options)
}

#[command]
pub(crate) async fn watch_position<R: Runtime>(
    app: AppHandle<R>,
    options: PositionOptions,
    channel: Channel,
) -> Result<()> {
    app.geolocation().watch_position_inner(options, channel)
}

#[command]
pub(crate) async fn clear_watch<R: Runtime>(app: AppHandle<R>, channel_id: u32) -> Result<()> {
    app.geolocation().clear_watch(channel_id)
}

#[command]
pub(crate) async fn check_permissions<R: Runtime>(app: AppHandle<R>) -> Result<PermissionStatus> {
    app.geolocation().check_permissions()
}

#[command]
pub(crate) async fn request_permissions<R: Runtime>(
    app: AppHandle<R>,
    permissions: Option<Vec<PermissionType>>,
) -> Result<PermissionStatus> {
    app.geolocation().request_permissions(permissions)
}

// WMap: Aufzeichnen bei ausgeschaltetem Bildschirm (android/src/main/java/RecordService.kt)

#[command]
pub(crate) async fn start_recording<R: Runtime>(app: AppHandle<R>, state: Option<serde_json::Value>) -> Result<()> {
    app.geolocation().start_recording(state.unwrap_or_else(|| serde_json::json!({})))
}

#[command]
pub(crate) async fn stop_recording<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    app.geolocation().stop_recording()
}

#[command]
pub(crate) async fn take_recorded<R: Runtime>(app: AppHandle<R>, state: Option<serde_json::Value>) -> Result<serde_json::Value> {
    app.geolocation().take_recorded(state.unwrap_or_else(|| serde_json::json!({})))
}

#[command]
pub(crate) async fn notification_state<R: Runtime>(app: AppHandle<R>) -> Result<serde_json::Value> {
    app.geolocation().notification("notificationState")
}

#[command]
pub(crate) async fn request_notification<R: Runtime>(app: AppHandle<R>) -> Result<serde_json::Value> {
    app.geolocation().notification("requestNotification")
}
