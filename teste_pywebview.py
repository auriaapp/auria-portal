"""
Teste mínimo para diagnosticar problema de exposição da API PyWebView
Execute: py teste_pywebview.py
"""
import webview

# Bridge como classe simples
class Api:
    def ping(self):
        print("[Python] ping() chamado!")
        return "pong"
    
    def login(self, email, senha):
        print(f"[Python] login() chamado: {email}")
        return {"ok": True, "msg": "Login simulado"}

# HTML mínimo de teste
HTML = """
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Teste PyWebView</title>
    <style>
        body { font-family: Arial; padding: 40px; background: #1a1a2e; color: white; }
        button { padding: 15px 30px; font-size: 18px; margin: 10px; cursor: pointer; }
        #log { background: #16213e; padding: 20px; margin-top: 20px; border-radius: 8px; 
               font-family: monospace; white-space: pre-wrap; min-height: 200px; }
    </style>
</head>
<body>
    <h1>Teste PyWebView API</h1>
    <button onclick="testarAPI()">Testar window.pywebview</button>
    <button onclick="testarPing()">Chamar ping()</button>
    <button onclick="testarLogin()">Chamar login()</button>
    <div id="log">Aguardando...</div>

    <script>
        function log(msg) {
            document.getElementById('log').textContent += '\\n' + msg;
            console.log(msg);
        }

        // Esperar API ficar disponível
        function esperarAPI(callback, tentativas = 0) {
            if (tentativas > 50) {
                log('❌ API não disponível após 5 segundos');
                return;
            }
            
            if (window.pywebview && window.pywebview.api) {
                const keys = Object.keys(window.pywebview.api);
                log('✅ API disponível! Métodos: ' + JSON.stringify(keys));
                if (callback) callback();
            } else {
                setTimeout(() => esperarAPI(callback, tentativas + 1), 100);
            }
        }

        // Escutar evento _pywebviewready (com underscore)
        window.addEventListener('_pywebviewready', function() {
            log('📡 Evento _pywebviewready disparado');
            esperarAPI();
        });

        // Também tentar sem evento (fallback)
        setTimeout(() => {
            log('⏰ Verificação por timeout...');
            log('window.pywebview = ' + typeof window.pywebview);
            if (window.pywebview) {
                log('window.pywebview.api = ' + typeof window.pywebview.api);
                if (window.pywebview.api) {
                    log('Métodos: ' + JSON.stringify(Object.keys(window.pywebview.api)));
                }
            }
        }, 2000);

        function testarAPI() {
            log('--- Teste de API ---');
            log('window.pywebview: ' + (window.pywebview ? 'existe' : 'NÃO existe'));
            if (window.pywebview) {
                log('window.pywebview.api: ' + (window.pywebview.api ? 'existe' : 'NÃO existe'));
                if (window.pywebview.api) {
                    const keys = Object.keys(window.pywebview.api);
                    log('Métodos encontrados: ' + keys.length);
                    keys.forEach(k => log('  - ' + k));
                }
            }
        }

        async function testarPing() {
            log('--- Chamando ping() ---');
            try {
                if (!window.pywebview?.api?.ping) {
                    log('❌ ping não existe na API');
                    return;
                }
                const result = await window.pywebview.api.ping();
                log('✅ Resposta: ' + result);
            } catch (e) {
                log('❌ Erro: ' + e.message);
            }
        }

        async function testarLogin() {
            log('--- Chamando login() ---');
            try {
                if (!window.pywebview?.api?.login) {
                    log('❌ login não existe na API');
                    return;
                }
                const result = await window.pywebview.api.login('teste@email.com', '123456');
                log('✅ Resposta: ' + JSON.stringify(result));
            } catch (e) {
                log('❌ Erro: ' + e.message);
            }
        }
    </script>
</body>
</html>
"""

if __name__ == "__main__":
    print("=" * 50)
    print("TESTE MÍNIMO PYWEBVIEW")
    print("=" * 50)
    
    # Criar instância da API
    api = Api()
    
    # Listar métodos disponíveis
    metodos = [m for m in dir(api) if not m.startswith('_') and callable(getattr(api, m))]
    print(f"[Python] Métodos no objeto api: {metodos}")
    
    # Criar janela com a API
    print("[Python] Criando janela...")
    window = webview.create_window(
        title="Teste PyWebView",
        html=HTML,
        width=600,
        height=500,
        js_api=api  # <-- Expor a API aqui
    )
    
    print(f"[Python] Janela criada com API")
    print("[Python] Iniciando webview.start()...")
    
    webview.start(debug=True)
    
    print("[Python] Encerrado.")
