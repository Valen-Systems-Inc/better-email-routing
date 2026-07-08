use std::{
    net::TcpStream,
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

const SERVER_HOST: &str = "127.0.0.1";
const DEFAULT_SERVER_PORT: &str = "8899";

struct MailServerChild(Mutex<Option<CommandChild>>);

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            let resource_dir = app.path().resource_dir()?;
            std::fs::create_dir_all(&app_data_dir)?;

            let server_port = std::env::var("BETTER_EMAIL_ROUTING_APP_PORT")
                .or_else(|_| std::env::var("PORT"))
                .unwrap_or_else(|_| DEFAULT_SERVER_PORT.to_string());
            let server_url = format!("http://{SERVER_HOST}:{server_port}");
            let sidecar_command = app
                .shell()
                .sidecar("core-mail-server")?
                .env("BETTER_EMAIL_ROUTING_HOME", app_data_dir.to_string_lossy().to_string())
                .env("CORE_MAIL_RESOURCE_ROOT", resource_dir.to_string_lossy().to_string())
                .env("HOST", SERVER_HOST)
                .env("PORT", &server_port);

            let (mut rx, child) = sidecar_command.spawn()?;
            app.manage(MailServerChild(Mutex::new(Some(child))));

            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(bytes) => {
                            println!("[core-mail-server] {}", String::from_utf8_lossy(&bytes).trim_end());
                        }
                        CommandEvent::Stderr(bytes) => {
                            eprintln!("[core-mail-server] {}", String::from_utf8_lossy(&bytes).trim_end());
                        }
                        _ => {}
                    }
                }
            });

            wait_for_server(&server_port)?;

            WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::External(server_url.parse()?),
            )
            .title("Core Mail")
            .inner_size(1380.0, 860.0)
            .min_inner_size(960.0, 680.0)
            .background_color((251, 251, 253, 255).into())
            .build()?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                stop_mail_server(window.app_handle());
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Core Mail");
}

fn wait_for_server(port: &str) -> Result<(), Box<dyn std::error::Error>> {
    let address = format!("{SERVER_HOST}:{port}");
    let deadline = Instant::now() + Duration::from_secs(10);

    while Instant::now() < deadline {
        if TcpStream::connect(&address).is_ok() {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(100));
    }

    Err(format!("Core Mail server did not start on {address}.").into())
}

fn stop_mail_server(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<MailServerChild>() {
        if let Ok(mut child) = state.0.lock() {
            if let Some(child) = child.take() {
                let _ = child.kill();
            }
        }
    }
}
