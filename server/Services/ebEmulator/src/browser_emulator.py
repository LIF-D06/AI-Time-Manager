import os
import threading
import time
import json
from typing import Optional, Tuple, List, Dict, Any
from playwright.sync_api import (
    sync_playwright,
    Playwright,
    Page,
    Browser,
    Response,
    Request,
    ConsoleMessage,
)


class BrowserEmulator:
    """
    BrowserEmulator

    这是一个轻量级的“浏览器仿真”工具，用于在可控环境中运行页面 JavaScript 并收集运行时事件。

    主要功能
    - 启动/停止浏览器实例
    - 访问 URL 并等待加载
    - 捕获 console、network、fetch/XHR、DOM 变动和弹窗事件
    - 获取/设置 cookies

    初始化参数
    - headless: 是否以无头模式运行（bool）
    - browser_type: 播放器类型，常用值 'chromium'/'firefox'/'webkit'

    约定
    - 必须先调用 start() 再调用其他方法；在未启动时调用会抛出 RuntimeError

    失败/异常模式
    - 对外 API 在遇到内部错误时会尽量捕获并把错误信息记入事件列表，而不是抛出不可控异常
    """

    def __init__(self, headless: bool = True, browser_type: str = "chromium") -> None:
        self.headless = headless
        self.browser_type = browser_type
        self.allow_popups = True
        self._pw: Optional[Playwright] = None
        self._browser: Browser
        self._focusedpage: Optional[Page] = None
        self._pages: List[Page] = []
        self._events: List[Dict[str, Any]] = []
        self._console_lock = threading.Lock()
        self._init_script_cache = None

    def _load_init_script_parts(self) -> Tuple[str, str]:
        here = os.path.dirname(__file__)
        base_path = os.path.join(here, 'browser_emulator.base.js')
        open_path = os.path.join(here, 'browser_emulator.open.js')
        base = ''
        open_part = ''
        if os.path.exists(base_path):
            try:
                with open(base_path, 'r', encoding='utf-8') as f:
                    base = f.read()
            except Exception:
                base = ''
        if os.path.exists(open_path):
            try:
                with open(open_path, 'r', encoding='utf-8') as f:
                    open_part = f.read()
            except Exception:
                open_part = ''
        # backward compatibility: if neither separate file exists, try old single file
        if not base and not open_part:
            legacy_path = os.path.join(here, 'browser_emulator.js')
            if os.path.exists(legacy_path):
                try:
                    with open(legacy_path, 'r', encoding='utf-8') as f:
                        content = f.read()
                    parts = content.split('\n/*--OPEN--*/\n')
                    base = parts[0]
                    open_part = parts[1] if len(parts) > 1 else ''
                except Exception:
                    base = ''
                    open_part = ''
        return base, open_part

    def _get_init_script(self) -> str:
        if self._init_script_cache is not None:
            return self._init_script_cache
        base, open_part = self._load_init_script_parts()
        prefix = "() => {\n            try{\n"
        suffix = "\n            }catch(e){}\n        }"
        if self.allow_popups:
            init_script = prefix + base + suffix
        else:
            init_script = prefix + base + open_part + suffix
        self._init_script_cache = init_script
        return init_script

    def start(self) -> None:
        if self._pw:
            return
        self._pw = sync_playwright().start()
        browser_launcher = getattr(self._pw, self.browser_type)
        self._browser = browser_launcher.launch(headless=self.headless)
        context = self._browser.new_context()
        self._context = context
        page = context.new_page()
        self._focusedpage = page
        self._pages.append(page)

        def _report(ev: Dict[str, Any]) -> None:
            with self._console_lock:
                ev.setdefault("ts", time.time())
                self._events.append(ev)

        def _attach_page_handlers(page: Page) -> None:
            try:
                page.expose_function("py_report", _report)
            except Exception:
                pass

            def _on_console(msg: ConsoleMessage) -> None:
                with self._console_lock:
                    self._events.append({
                        "type": "console",
                        "text": msg.text,
                        "location": {
                            "url": msg.location.get("url"),
                            "lineNumber": msg.location.get("lineNumber"),
                        },
                        "ts": time.time(),
                    })

            page.on("console", _on_console)

            def _on_response(resp: Response) -> None:
                try:
                    entry = {
                        "type": "response",
                        "url": resp.url,
                        "status": resp.status,
                        "headers": dict(resp.headers or {}),
                        "ts": time.time(),
                    }
                    try:
                        ct = (resp.headers or {}).get("content-type", "")
                        if any(t in ct for t in ("text", "javascript", "json", "xml", "html")):
                            try:
                                body = resp.text()
                                entry["body_snippet"] = body[:1000]
                            except Exception as e:
                                entry["body_read_error"] = str(e)
                    except Exception:
                        pass
                    with self._console_lock:
                        self._events.append(entry)
                except Exception:
                    with self._console_lock:
                        self._events.append({"type": "response_handler_error", "url": getattr(resp, 'url', None), "ts": time.time()})

            page.on("response", _on_response)

            def _on_request(req: Request) -> None:
                try:
                    with self._console_lock:
                        self._events.append({
                            "type": "request",
                            "url": req.url,
                            "method": req.method,
                            "resource_type": req.resource_type,
                            "ts": time.time(),
                        })
                except Exception:
                    pass

            page.on("request", _on_request)

            def _on_pageerror(err: Exception) -> None:
                with self._console_lock:
                    self._events.append({"type": "pageerror", "error": str(err), "ts": time.time()})

            page.on("pageerror", _on_pageerror)

            def _on_request_failed(req: Request) -> None:
                with self._console_lock:
                    self._events.append({
                        "type": "requestfailed",
                        "url": req.url,
                        "failure": getattr(req, "failure", None),
                        "ts": time.time(),
                    })

            page.on("requestfailed", _on_request_failed)

            def _on_popup(popup_page: Page) -> None:
                try:
                    with self._console_lock:
                        self._events.append({"type": "popup", "url": popup_page.url, "ts": time.time()})
                    try:
                        self._pages.append(popup_page)
                    except Exception:
                        pass
                    if not self.allow_popups:
                        try:
                            u = popup_page.url
                            try:
                                if self._focusedpage:
                                    self._focusedpage.goto(u)
                            except Exception:
                                pass
                        except Exception:
                            pass
                        try:
                            popup_page.close()
                        except Exception:
                            pass
                except Exception:
                    pass

            page.on("popup", _on_popup)

            try:
                for f in page.frames:
                    try:
                        f.evaluate(f"({self._get_init_script()})()")
                    except Exception:
                        pass
            except Exception:
                pass

        _attach_page_handlers(page)

        try:
            context.on("page", lambda p: (self._pages.append(p), _attach_page_handlers(p)))
        except Exception:
            pass

    def click(self, selector: str, timeout_ms: int = 10000) -> None:
        if not self._focusedpage:
            raise RuntimeError("Browser not started. Call start() first.")
        self._focusedpage.wait_for_selector(selector, timeout=timeout_ms)

    def wait_for_load(self, state: str = "load", timeout_ms: int = 30000) -> None:
        if not self._focusedpage:
            raise RuntimeError("Browser not started. Call start() first.")
        self._focusedpage.wait_for_load_state(state, timeout=timeout_ms)

    def visit(self, url: str, timeout_ms: int = 30000, wait_until: str = "load") -> Page:
        if not self._focusedpage:
            raise RuntimeError("Browser not started. Call start() first.")
        with self._console_lock:
            self._events.append({"type": "navigation_start", "url": url, "ts": time.time()})
        self._focusedpage.goto(url, timeout=timeout_ms, wait_until=wait_until)
        return self._focusedpage

    def eval_js(self, expression: str) -> Any:
        if not self._focusedpage:
            raise RuntimeError("Browser not started. Call start() first.")
        return self._focusedpage.evaluate(expression)

    def get_content(self) -> Optional[str]:
        if not self._focusedpage:
            raise RuntimeError("Browser not started. Call start() first.")
        try:
            return self._focusedpage.content()
        except Exception:
            return None

    def get_events(self, clear: bool = False) -> List[Dict[str, Any]]:
        with self._console_lock:
            events = list(self._events)
            if clear:
                self._events.clear()
            return events

    def stop(self) -> None:
        try:
            try:
                if self._browser:
                    self._browser.close()
            except Exception as e:
                with self._console_lock:
                    self._events.append({"type": "stop_error", "phase": "browser_close", "error": str(e), "ts": time.time()})
            try:
                if self._pw:
                    self._pw.stop()
            except Exception as e:
                with self._console_lock:
                    self._events.append({"type": "stop_error", "phase": "playwright_stop", "error": str(e), "ts": time.time()})
        finally:
            self._pw = None
            self._focusedpage = None
            self._pages = []

    @property
    def focusedpage(self):
        return self._focusedpage


if __name__ == "__main__":
    be = BrowserEmulator(headless=True)
    be.start()
    be.visit('https://example.com')
    time.sleep(2)
    ev = be.get_events()
    print(json.dumps(ev, indent=2, ensure_ascii=False))
    be.stop()