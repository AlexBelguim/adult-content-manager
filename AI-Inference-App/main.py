import os
import sys
import threading
import subprocess
import time
from pathlib import Path

from PIL import Image, ImageDraw
import pystray
from pystray import MenuItem as item
import pyperclip
from pyngrok import ngrok
import tkinter as tk
from tkinter import scrolledtext

# Configuration
PORT = 3344
URL = f"http://localhost:{PORT}"
MODELS_DIR = Path(__file__).parent / "models"
SERVER_SCRIPT = Path(__file__).parent / "server.py"

class AIAppTray:
    def __init__(self):
        self.server_process = None
        self.icon = None
        self.is_running = True
        self.public_url = None
        self.ngrok_tunnel = None
        self.ssh_process = None
        self.log_window = None
        self.log_text_area = None
        self.logs = []
        
        # Ensure models dir exists
        MODELS_DIR.mkdir(exist_ok=True)
        
    def create_image(self, color=(0, 229, 255)):
        width, height = 64, 64
        image = Image.new('RGB', (width, height), (15, 15, 26))
        dc = ImageDraw.Draw(image)
        dc.ellipse([8, 8, 56, 56], fill=color)
        dc.ellipse([16, 16, 48, 48], fill=(15, 15, 26))
        return image

    def copy_url(self):
        url = self.public_url if self.public_url else URL
        pyperclip.copy(url)
        if self.icon:
            self.icon.notify(f"URL copied: {url}", "AI System")

    def toggle_public_ngrok(self):
        if self.ngrok_tunnel:
            ngrok.disconnect(self.ngrok_tunnel.public_url)
            self.ngrok_tunnel = None
            self.public_url = None
            if self.icon:
                self.icon.icon = self.create_image((0, 229, 255))
                self.icon.notify("Ngrok tunnel closed", "AI System")
        else:
            try:
                token_file = Path(__file__).parent / "ngrok_token.txt"
                if token_file.exists():
                    ngrok.set_auth_token(token_file.read_text().strip())
                
                self.ngrok_tunnel = ngrok.connect(PORT)
                self.public_url = self.ngrok_tunnel.public_url
                if self.icon:
                    self.icon.icon = self.create_image((76, 175, 80))
                    self.icon.notify(f"Ngrok URL active: {self.public_url}", "AI System")
                    self.copy_url()
            except Exception as e:
                if self.icon: self.icon.notify(f"Ngrok failed: {str(e)}", "AI System")

    def toggle_ssh_tunnel(self):
        if self.ssh_process:
            self.ssh_process.terminate()
            self.ssh_process = None
            self.public_url = None
            if self.icon:
                self.icon.icon = self.create_image((0, 229, 255))
                self.icon.notify("Zero-config tunnel closed", "AI System")
        else:
            try:
                cmd = ["ssh", "-R", f"80:localhost:{PORT}", "nokey@localhost.run", "-o", "StrictHostKeyChecking=no"]
                self.ssh_process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0)
                
                def find_url():
                    for line in iter(self.ssh_process.stdout.readline, ''):
                        if ".lhr.life" in line or ".localhost.run" in line:
                            import re
                            urls = re.findall(r'https://[^\s]+', line)
                            if urls:
                                self.public_url = urls[0].strip()
                                if self.icon:
                                    self.icon.icon = self.create_image((255, 152, 0))
                                    self.icon.notify(f"Public URL active: {self.public_url}", "AI System")
                                    self.copy_url()
                                break
                        if not self.ssh_process: break
                threading.Thread(target=find_url, daemon=True).start()
            except Exception as e:
                if self.icon: self.icon.notify(f"SSH failed: {str(e)}", "AI System")

    def start_server(self):
        if self.server_process: return
        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"
        
        # Launch in a NEW VISIBLE CONSOLE to prevent piping/buffering hangs
        self.server_process = subprocess.Popen(
            [sys.executable, str(SERVER_SCRIPT)], 
            env=env,
            creationflags=subprocess.CREATE_NEW_CONSOLE if sys.platform == 'win32' else 0
        )
        print("🚀 AI Server launched in a new terminal window.")
        # No longer piping logs through the tray app to ensure maximum stability
        # You can see logs directly in the opened terminal window
        pass

    def show_terminal(self):
        if self.log_window and tk.Toplevel.winfo_exists(self.log_window):
            self.log_window.lift()
            return

        def run_tk():
            self.log_window = tk.Tk()
            self.log_window.title("DINOv2 AI Server Logs")
            self.log_window.geometry("800x500")
            self.log_window.configure(bg="#0f0f1a")
            
            # Icon
            try:
                self.log_window.iconphoto(False, tk.PhotoImage(data=self.create_image()))
            except: pass

            self.log_text_area = scrolledtext.ScrolledText(
                self.log_window, 
                wrap=tk.WORD, 
                bg="#0a0a0f", 
                fg="#00e5ff", 
                insertbackground="#fff",
                font=("Consolas", 10)
            )
            self.log_text_area.pack(expand=True, fill='both', padx=10, pady=10)
            
            # Load existing logs
            for log in self.logs:
                self.log_text_area.insert(tk.END, log + "\n")
            self.log_text_area.see(tk.END)

            self.log_window.protocol("WM_DELETE_WINDOW", self.hide_terminal)
            self.log_window.mainloop()

        threading.Thread(target=run_tk, daemon=True).start()

    def hide_terminal(self):
        if self.log_window:
            self.log_window.destroy()
            self.log_window = None
            self.log_text_area = None

    def stop(self):
        self.is_running = False
        if self.server_process: self.server_process.terminate()
        if self.ssh_process: self.ssh_process.terminate()
        if self.icon: self.icon.stop()

    def run(self):
        self.start_server()
        menu = pystray.Menu(
            item('Copy API URL', self.copy_url, default=True),
            item('Show Logs / Terminal', self.show_terminal),
            pystray.Menu.SEPARATOR,
            item(lambda t: "Stop Zero-Config" if self.ssh_process else "Start Zero-Config Tunnel", self.toggle_ssh_tunnel),
            item(lambda t: "Stop Ngrok" if self.ngrok_tunnel else "Start Ngrok Tunnel", self.toggle_public_ngrok),
            pystray.Menu.SEPARATOR,
            item('Quit AI System', self.stop)
        )
        self.icon = pystray.Icon("ai_app", self.create_image(), "DINOv2 AI System", menu)
        self.icon.run()

if __name__ == "__main__":
    try:
        print(f"Starting AI System Tray...")
        print(f"URL: {URL}")
        os.chdir(os.path.dirname(os.path.abspath(__file__)))
        app = AIAppTray()
        app.run()
    except Exception as e:
        print(f"\n❌ FATAL STARTUP ERROR: {e}")
        import traceback
        traceback.print_exc()
        input("\nPress ENTER to close...")
    except KeyboardInterrupt:
        if 'app' in locals(): app.stop()
