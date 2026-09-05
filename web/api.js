export class Api {
  csrf='';guild='';
  async request(path,options={}) {
    const origin=(window.JUMANJI_API_ORIGIN||'').replace(/\/$/,'');
    const response=await fetch(`${origin}${path}`,{credentials:origin?'include':'same-origin',...options,headers:{...(options.body && !(options.body instanceof Blob)?{'Content-Type':'application/json'}:{}),...(options.method && options.method!=='GET'?{'X-CSRF-Token':this.csrf}:{}),...options.headers}});
    if(!response.ok){const body=await response.json().catch(()=>({}));const error=new Error(body.error?.message||`Não foi possível concluir (${response.status})`);error.status=response.status;throw error;}
    return response.headers.get('content-type')?.includes('application/json')?response.json():response.blob();
  }
  view(kind,page=1,q=''){return this.request(`/api/guilds/${encodeURIComponent(this.guild)}/${kind}?page=${page}&q=${encodeURIComponent(q)}`);}
  act(action,data={}){return this.request(`/api/guilds/${encodeURIComponent(this.guild)}/actions/${action}`,{method:'POST',body:JSON.stringify(data)});}
}
export function download(blob,name){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
