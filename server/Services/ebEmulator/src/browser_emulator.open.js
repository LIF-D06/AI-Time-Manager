try{
    const origOpen = window.open.bind(window);
    window.open = function(url, target, features){
        try{
            send({type:'new_window_redirect', url: String(url), target: target || null});
            try{ window.location.assign(String(url)); }catch(e){ }
            return null;
        }catch(e){
            try{ return origOpen(url, target, features); }catch(e2){ return null; }
        }
    };
}catch(e){}

try{
    document.addEventListener('click', function(e){
        try{
            let el = e.target;
            while(el && el.nodeType===1){
                if(el.tagName && el.tagName.toLowerCase()==='a' && el.target==='_'+'blank' && el.href){
                    e.preventDefault();
                    send({type:'new_window_redirect', url: el.href, selector: null});
                    try{ window.location.assign(el.href); }catch(err){}
                    break;
                }
                el = el.parentNode;
            }
        }catch(err){}
    }, true);
}catch(e){}
