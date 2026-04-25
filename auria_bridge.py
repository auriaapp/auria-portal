"""
AuriaBridge — servidor HTTP mini para comunicação HTML ↔ Python
Funciona com QUALQUER versão do PyWebView
"""
import json, threading, sys
from http.server import HTTPServer, BaseHTTPRequestHandler

_bridge_instance = None

class AuriaBridgeHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # silencia logs HTTP

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        body   = self.rfile.read(length)
        method = self.path.lstrip('/')
        try:
            dados = json.loads(body) if body else None
        except:
            dados = None

        self.send_response(200)
        self._cors()
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(b'{"ok":true}')

        # Despacha para o bridge em thread separada
        if _bridge_instance and hasattr(_bridge_instance, method):
            arg = json.dumps(dados) if dados else None
            threading.Thread(
                daemon=True,
                target=lambda: getattr(_bridge_instance, method)(arg)
            ).start()
        else:
            print(f"[Bridge] Método não encontrado: {method}")

    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')


class AuriaBridge:
    def __init__(self, app):
        global _bridge_instance
        self.app     = app
        self._window = None
        self._port   = None
        _bridge_instance = self
        self._iniciar_servidor()

    def _iniciar_servidor(self):
        server = HTTPServer(('127.0.0.1', 0), AuriaBridgeHandler)
        self._port = server.server_address[1]
        print(f"[Bridge] API server na porta {self._port}")
        threading.Thread(daemon=True, target=server.serve_forever).start()

    def set_window(self, window):
        self._window = window

    def _js(self, code):
        if self._window:
            try:
                self._window.evaluate_js(code)
            except Exception as e:
                print(f"[JS] Erro: {e}")

    # ── CICLO DE VIDA ────────────────────────────────────────────────────────

    def ui_pronta(self, _=None):
        main = sys.modules.get('__main__')
        threading.Thread(daemon=True, target=self._enviar_bg).start()
        HAS_REQUESTS = getattr(main, 'HAS_REQUESTS', False)
        if HAS_REQUESTS and self.app._supa_carregar_token():
            self._enviar_user()
            self._js(f"mostrarHome('{self._emp_json()}')")
            self.app.after(5000, self.app._iniciar_polling_mensagens)

    def _enviar_bg(self):
        main = sys.modules.get('__main__')
        b64 = getattr(main, '_BG_PASSO1_B64', '').strip().replace('\n','')
        if b64:
            self._js(f"setBg('{b64}')")

    def _enviar_user(self):
        main = sys.modules.get('__main__')
        user = getattr(main, '_SUPA_USER', None)
        if user:
            self._js(f"setUser('{json.dumps(user)}')")

    def _emp_json(self):
        emp = self.app._emp_config
        return json.dumps({
            'nome':  emp.get('nome',''),
            'etapa': emp.get('ultima_etapa', self.app.meta_etapa or ''),
            'tipo':  emp.get('tipo_empreendimento',''),
        }).replace("'","\\'")

    def _tick(self, _=None):
        try: self.app.update()
        except: pass

    # ── AUTH ─────────────────────────────────────────────────────────────────

    def login(self, dados_json):
        def _run():
            try:
                d = json.loads(dados_json or '{}')
                print(f"[Bridge] Login: {d.get('email')}")
                ok, msg = self.app._supa_login(d.get('email',''), d.get('senha',''))
                print(f"[Bridge] Login resultado: ok={ok}")
                if ok:
                    self._enviar_user()
                    self._js("loginResultado(true,'')")
                    import time; time.sleep(0.4)
                    self._js(f"mostrarHome('{self._emp_json()}')")
                    self.app.after(5000, self.app._iniciar_polling_mensagens)
                else:
                    safe = (msg or 'Erro').replace("'","\\'").replace('\n',' ')
                    self._js(f"loginResultado(false,'{safe}')")
            except Exception as e:
                print(f"[Bridge] Login error: {e}")
                self._js("loginResultado(false,'Erro interno.')")
        threading.Thread(daemon=True, target=_run).start()

    def cadastro(self, dados_json):
        def _run():
            try:
                d = json.loads(dados_json or '{}')
                ok, msg = self.app._supa_cadastro(
                    d.get('email',''), d.get('senha',''), d.get('nome',''))
                if ok:
                    self._enviar_user()
                    self._js("loginResultado(true,'')")
                    import time; time.sleep(0.4)
                    self._js(f"mostrarHome('{self._emp_json()}')")
                else:
                    safe = (msg or 'Erro').replace("'","\\'").replace('\n',' ')
                    self._js(f"loginResultado(false,'{safe}')")
            except Exception as e:
                self._js("loginResultado(false,'Erro interno.')")
        threading.Thread(daemon=True, target=_run).start()

    def sair_conta(self, _=None):
        self.app._supa_logout()
        self._js("showScreen('screen-login')")

    # ── NAVEGAÇÃO ────────────────────────────────────────────────────────────

    def nova_analise(self, _=None):
        self.app.after(0, self.app.nova_analise)

    def abrir_analise(self, _=None):
        self.app.after(0, self.app.abrir_analise)

    def salvar_analise(self, _=None):
        self.app.after(0, self.app.salvar_analise)

    def abrir_config_emp(self, _=None):
        self.app.after(0, self.app.abrir_wizard_empreendimento)

    def abrir_painel_bi(self, _=None):
        self.app.after(0, self.app.abrir_painel_bi)

    def abrir_kanban(self, _=None):
        self.app.after(0, self.app.abrir_kanban)

    def abrir_dashboard(self, _=None):
        self.app.after(0, self.app.abrir_painel_bi)

    def comparar_revisoes(self, _=None):
        self.app.after(0, self.app.abrir_comparador_revisoes)

    def abrir_trena(self, _=None):
        self.app.after(0, self.app.abrir_painel_trena)

    def abrir_filtros(self, _=None):
        self.app.after(0, self.app.abrir_menu_filtros)

    def abrir_sobre(self, _=None):
        self.app.after(0, self.app.abrir_sobre)

    def desfazer(self, _=None):
        self.app.after(0, self.app.undo)

    def refazer(self, _=None):
        self.app.after(0, self.app.redo)

    def abrir_apontamento(self, issue_id):
        if issue_id:
            issue = next((i for i in self.app.lista_issues
                         if i['id'] == issue_id), None)
            if issue:
                self.app.after(0, lambda: self.app.abrir_janela_issue(issue))

    def notificar_mensagens(self, total):
        self._js(f"notificarMensagens({total})")

    def atualizar_app(self):
        from datetime import datetime as _dt
        apts = []
        for iss in self.app.lista_issues:
            prazos = [p.get('prazo','') for p in iss.get('participantes',{}).values()
                      if p.get('prazo','') and not p.get('conclusao','').strip()]
            apts.append({
                'id':         iss['id'],
                'titulo':     iss.get('titulo',''),
                'status':     iss.get('status',''),
                'disciplina': iss.get('disciplina',''),
                'prazo_min':  min(prazos) if prazos else '',
            })
        dados = {
            'empreendimento': self.app.meta_empreendimento,
            'analise':        self.app.meta_etapa,
            'disciplina':     getattr(self.app, 'disciplina_ativa', '') or '',
            'apontamentos':   apts,
        }
        self._js(f"mostrarApp({json.dumps(dados)})")
