window.__emulator_injected = true;
window.__emulator_events = [];

const send = (obj) => {
    try{ obj.page_id = (window.__PAGE_ID||null); window.py_report(obj); } catch(e) { }
};

const origFetch = window.fetch;
window.fetch = function(...args){
    const p = origFetch.apply(this, args);
    p.then(async res => {
        try{
            const clone = res.clone();
            const ct = clone.headers.get('content-type') || '';
            let text = null;
            if (/text|javascript|json|xml|html/.test(ct)){
                try{ text = await clone.text(); text = text.slice(0,1000); } catch(e) { text = null; }
            }
            send({type:'fetch', url: res.url, status: res.status, text_snippet: text});
        }catch(e){}
    }).catch(e => {
        send({type:'fetch_error', args: args, error: String(e)});
    });
    return p;
};

(function(){
    const X = XMLHttpRequest.prototype;
    const open = X.open;
    const sendX = X.send;
    X.open = function(method, url, ...rest){ this.__url = url; return open.call(this, method, url, ...rest); };
    X.send = function(body){
        this.addEventListener('load', ()=>{
            try{
                let snippet = null;
                if (typeof this.responseText === 'string') snippet = this.responseText.slice(0,1000);
                send({type:'xhr', url: this.__url, status: this.status, response_snippet: snippet});
            }catch(e){}
        });
        return sendX.call(this, body);
    };
})();

try{
    const obs = new MutationObserver((mutations) => {
        try{
            const items = [];
            for(const m of mutations){
                items.push({type: m.type, target: m.target.nodeName, added: m.addedNodes? m.addedNodes.length:0});
                if(items.length >= 5) break;
            }
            if(items.length) send({type:'mutations', mutations: items});
        }catch(e){}
    });
    obs.observe(document, {childList:true, subtree:true});
}catch(e){}
