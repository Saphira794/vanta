// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf, process::Command};
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Game {
    id: String,
    title: String,
    platform: String,
    #[serde(default)]
    app_id: Option<String>,
    exe_path: String,
    #[serde(default)]
    local_image: Option<String>,
}

fn library_file_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir error: {e}"))?;
    Ok(dir.join("library.json"))
}

fn read_library(app: &tauri::AppHandle) -> Result<Vec<Game>, String> {
    let path = library_file_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(&path).map_err(|e| format!("read error: {e}"))?;
    serde_json::from_str::<Vec<Game>>(&content).map_err(|e| format!("json parse error: {e}"))
}

fn write_library(app: &tauri::AppHandle, games: &[Game]) -> Result<(), String> {
    let path = library_file_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir error: {e}"))?;
    }
    let content = serde_json::to_string_pretty(games).map_err(|e| format!("json encode error: {e}"))?;
    fs::write(&path, content).map_err(|e| format!("write error: {e}"))
}

#[tauri::command]
fn list_games(app: tauri::AppHandle) -> Result<Vec<Game>, String> {
    read_library(&app)
}

#[tauri::command]
fn upsert_game(app: tauri::AppHandle, game: Game) -> Result<Vec<Game>, String> {
    let mut games = read_library(&app)?;
    if let Some(existing) = games.iter_mut().find(|g| g.id == game.id) {
        *existing = game;
    } else {
        games.push(game);
    }
    write_library(&app, &games)?;
    Ok(games)
}

#[tauri::command]
fn delete_game(app: tauri::AppHandle, id: String) -> Result<Vec<Game>, String> {
    let mut games = read_library(&app)?;
    games.retain(|g| g.id != id);
    write_library(&app, &games)?;
    Ok(games)
}

#[tauri::command]
fn launch_game(_app: tauri::AppHandle, exe_path: String) -> Result<(), String> {
    let path = PathBuf::from(&exe_path);
    if !path.exists() {
        return Err("exePath does not exist".to_string());
    }

    Command::new(path)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("launch error: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![list_games, upsert_game, delete_game, launch_game])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
