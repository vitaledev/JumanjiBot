import { afterAll,beforeAll,describe,expect,it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testDatabase } from "./support/database.js";
import { GameService } from "../src/core/service.js";
import { Store } from "../src/core/store.js";
import { AppError,type Actor } from "../src/core/contracts.js";
import { battleScore } from "../src/core/advanced.js";
import { Auth,type IdentityProvider } from "../src/http/auth.js";
import { Files,profileCard } from "../src/http/files.js";
import { createWebServer } from "../src/web-api.js";
import { JobRunner,type Effects } from "../src/infrastructure/jobs.js";
import { migrate } from "../src/infrastructure/migrations.js";
import { Database } from "../src/infrastructure/database.js";
import { publicAddress } from "../src/infrastructure/webhook.js";
let cluster:Awaited<ReturnType<typeof testDatabase>>,game:GameService;
const owner:Actor={id:'owner',name:'Administrador',admin:true},alice:Actor={id:'alice',name:'Alice',admin:false},bob:Actor={id:'bob',name:'Bob',admin:false};
const secret='test-privacy-secret-with-more-than-32-characters';
beforeAll(async()=>{cluster=await testDatabase();game=new GameService(new Store(cluster.database),secret);},120000);
afterAll(async()=>{if(cluster)await cluster.stop();},30000);
async function guild(){const id=randomUUID();await game.store.ensureGuild(id,'Teste');return id;}
const consent=(g:string,a=alice)=>game.act(g,a,'consent',{accept:true});
async function definition(g:string,kind:string,data:unknown){const row=await game.act(g,owner,'definition.save',{kind,data}) as any;await game.act(g,owner,'definition.publish',{kind,id:row.id});return row;}
async function division(g:string,limit=25){return await game.act(g,owner,'division.save',{number:1,name:'Norte',color:'#8B1E2D',memberLimit:limit}) as {id:string};}

describe('Persistência e invariantes reais no PostgreSQL',()=>{
  it('aplica migrações repetidas e concorrentes sem duplicação',async()=>{expect(await Promise.all([migrate(cluster.database),migrate(cluster.database)])).toEqual([[],[]]);});
  it('cadastro não aceita consentimento e opt-out sobrevive à sincronização',async()=>{const g=await guild();await game.enroll(g,alice);expect(await game.store.run(g,u=>game.member(u,alice.id,false))).toMatchObject({participation:'pending'});await expect(game.activity(g,alice.id,'text','message',{hash:'hello',length:10})).resolves.toBe(false);await consent(g);await game.act(g,alice,'privacy.leave',{confirm:true});await game.enroll(g,alice);expect(await game.store.run(g,u=>game.member(u,alice.id,false))).toBeUndefined();await consent(g);expect(await game.store.run(g,u=>game.member(u,alice.id))).toMatchObject({participation:'active'});});
  it('recompensa concorrente e nova conexão não duplicam saldo',async()=>{const g=await guild();await consent(g);await Promise.all(Array.from({length:10},()=>game.store.run(g,u=>game.reward(u,alice.id,{xp:25,credits:10},'same-event','Teste'))));const freshDb=new Database(cluster.url);try{const fresh=new GameService(new Store(freshDb),secret);expect(await fresh.store.run(g,u=>fresh.member(u,alice.id))).toMatchObject({xp:25,credits:10});await fresh.store.run(g,u=>fresh.reward(u,alice.id,{xp:25},'same-event','Teste'));expect(await fresh.store.run(g,u=>fresh.member(u,alice.id))).toMatchObject({xp:25});}finally{await freshDb.close();}});
  it('rollback impede saldo parcial e última vaga é exclusiva',async()=>{const g=await guild();await consent(g);await consent(g,bob);const d=await division(g,1);const results=await Promise.allSettled([game.act(g,alice,'division.join',{divisionId:d.id}),game.act(g,bob,'division.join',{divisionId:d.id})]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);await expect(game.store.run(g,async u=>{await game.reward(u,alice.id,{xp:30},'rollback','Teste');throw new Error('stop');})).rejects.toThrow('stop');expect(await game.store.run(g,u=>game.member(u,alice.id))).toMatchObject({xp:0});});
  it('não aceita divisão de outro servidor nem escrita de membro comum',async()=>{const g=await guild(),other=await guild();await consent(g);const d=await division(other);await expect(game.act(g,alice,'division.join',{divisionId:d.id})).rejects.toMatchObject({status:404});await expect(game.act(g,alice,'settings.save',{confirm:true,advanced:true})).rejects.toMatchObject({status:403});});
  it('compra concorrente é única e não permite saldo negativo',async()=>{const g=await guild();await consent(g);await game.act(g,owner,'settings.save',{advanced:true,confirm:true});const item=await definition(g,'item',{name:'Fundador',description:'Título',slot:'title',price:10});await game.store.run(g,u=>game.reward(u,alice.id,{credits:10},'seed','Teste'));await Promise.all(Array.from({length:5},()=>game.act(g,alice,'shop.buy',{id:item.id})));expect(await game.store.run(g,u=>game.member(u,alice.id))).toMatchObject({credits:0});expect((await game.view(g,alice,'inventory') as any).total).toBe(1);const second=await definition(g,'item',{name:'Outro',description:'Título',slot:'title',price:1});await expect(game.act(g,alice,'shop.buy',{id:second.id})).rejects.toThrow('Saldo insuficiente');});
  it('missão externa não premia rejeição nem revisão duplicada',async()=>{const g=await guild();await consent(g);await definition(g,'mission',{name:'Campanha externa',description:'Enviar prova',action:'external',target:1,period:'once',reward:{xp:50}});const assignment=(await game.view(g,alice,'assignment') as any).items[0];const proof=await game.act(g,alice,'proof.submit',{assignmentId:assignment.id,url:'https://example.com/proof'}) as any;await game.act(g,owner,'proof.review',{id:proof.id,decision:'CHANGES_REQUESTED',reason:'Envie uma prova completa'});expect(await game.store.run(g,u=>game.member(u,alice.id))).toMatchObject({xp:0});const fixed=await game.act(g,alice,'proof.submit',{assignmentId:assignment.id,url:'https://example.com/proof-fixed'}) as any;await game.act(g,owner,'proof.review',{id:fixed.id,decision:'APPROVED',reason:'Comprovação conferida'});await expect(game.act(g,owner,'proof.review',{id:fixed.id,decision:'APPROVED',reason:'Conferido novamente'})).rejects.toThrow('já foi revisada');expect(await game.store.run(g,u=>game.member(u,alice.id))).toMatchObject({xp:50});});
  it('presença exige organizador e só premia uma vez',async()=>{const g=await guild();await consent(g);const event=await definition(g,'event',{name:'Encontro',startsAt:new Date(Date.now()-60000).toISOString(),endsAt:new Date(Date.now()+3600000).toISOString(),reward:{xp:50}});await game.act(g,alice,'event.rsvp',{id:event.id});await expect(game.act(g,alice,'event.checkin',{id:event.id,userId:alice.id,reason:'Estou aqui'})).rejects.toMatchObject({status:403});await game.act(g,owner,'event.checkin',{id:event.id,userId:alice.id,reason:'Presença validada'});await game.act(g,owner,'event.checkin',{id:event.id,userId:alice.id,reason:'Presença validada'});expect(await game.store.run(g,u=>game.member(u,alice.id))).toMatchObject({xp:50});});
  it('congela ranking de temporada e repete apuração sem prêmio extra',async()=>{const g=await guild();await consent(g);const d=await division(g);await game.act(g,alice,'division.join',{divisionId:d.id});const season=await definition(g,'season',{name:'Zero',theme:'A base',prizes:[{place:1,reward:{credits:10}}]});await game.store.run(g,u=>game.reward(u,alice.id,{xp:20,division:5},'contribution','Teste'));await Promise.all([game.act(g,owner,'season.finish',{id:season.id}),game.act(g,owner,'season.finish',{id:season.id})]);expect(await game.store.run(g,u=>game.member(u,alice.id))).toMatchObject({xp:20,credits:10});const result=(await game.view(g,alice,'season') as any).items[0];expect(result.data.ranking[0]).toMatchObject({place:1,score:5});});
});

describe('API autenticada e processamento de tarefas',()=>{
  it('bloqueia anônimo, CSRF e servidor externo; não serve caminhos fora de web',async()=>{
    const g=await guild();await consent(g);
    const provider:IdentityProvider={exchange:async()=>{throw Error('No network');},authorize:async(_g,user)=>({...alice,id:user.id})};
    const auth=new Auth(cluster.database,provider,{origin:'http://localhost:4173',clientId:'test',secure:false});
    const session=await auth.create({id:alice.id,name:alice.name,guilds:[{id:g,name:'Teste'}]});
    const files=new Files(cluster.database,await mkdtemp(join(tmpdir(),'jumanji-files-'))),server=createWebServer(game,auth,files);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
    try{
      expect((await fetch(`${base}/api/me`)).status).toBe(401);
      const headers={Cookie:`jumanji_session=${session.token}`,'Content-Type':'application/json'};
      expect((await fetch(`${base}/api/guilds/${g}/actions/privacy.leave`,{method:'POST',headers,body:'{"confirm":true}'})).status).toBe(403);
      expect((await fetch(`${base}/api/guilds/not-mine/dashboard`,{headers})).status).toBe(403);
      const response=await fetch(`${base}/api/guilds/${g}/dashboard`,{headers});expect(response.status).toBe(200);expect((await response.json()).member.user_id).toBe(alice.id);
      expect((await fetch(`${base}/..%2f.env`)).status).toBe(404);
      expect((await fetch(`${base}/api/guilds/${g}/actions/settings.save`,{method:'POST',headers:{...headers,Origin:'http://localhost:4173','X-CSRF-Token':session.csrf},body:'{"confirm":true}'})).status).toBe(403);
    }finally{await new Promise<void>(r=>server.close(()=>r()));}
  });
  it('reprocessa tarefa abandonada e mantém exclusividade entre trabalhadores',async()=>{const g=await guild();const files=new Files(cluster.database,await mkdtemp(join(tmpdir(),'jumanji-files-')));let calls=0;const effects=new Proxy({},{get:()=>async()=>{calls++;return {done:true};}}) as Effects;const runner=new JobRunner(game,effects,files);const jobId=await game.store.run(g,u=>u.enqueue('provision','once',{actorId:owner.id}));await cluster.database.query("UPDATE jobs SET status='running',attempts=1,lease_until=NOW()-INTERVAL '1 second' WHERE id=$1",[jobId]);
    // Other tests enqueue real effects; isolate the due task for this assertion.
    await cluster.database.query("UPDATE jobs SET run_at=NOW()+INTERVAL '1 day' WHERE id<>$1 AND status='pending'",[jobId]);
    await Promise.all([runner.once(),runner.once()]);expect(calls).toBe(1);expect((await cluster.database.query('SELECT status,attempts FROM jobs WHERE id=$1',[jobId])).rows[0]).toMatchObject({status:'done',attempts:2});});
});

describe('Regras avançadas e arquivos',()=>{
  it('batalha usa média limitada e vantagem circular, mantendo empates',()=>{expect(battleScore([100,100,100],[100],'attack','attack',100)).toMatchObject({left:100,right:100,winner:'tie'});expect(battleScore([9999],[100],'attack','maneuver',100)).toMatchObject({left:110,right:100,winner:'left'});expect(battleScore([],[],'defend','attack',100).winner).toBe('tie');});
  it('bloqueia endereços privados de webhook',()=>{for(const ip of ['127.0.0.1','10.1.1.1','172.16.0.2','192.168.1.1','169.254.169.254','::1','::ffff:127.0.0.1','fc00::1'])expect(publicAddress(ip)).toBe(false);expect(publicAddress('1.1.1.1')).toBe(true);});
  it('gera PNG com identidade opcional e escapa SVG',()=>{const png=profileCard('<script>alert(1)</script>',500,'post',true);expect(png.subarray(0,8)).toEqual(Buffer.from([137,80,78,71,13,10,26,10]));expect(png.readUInt32BE(16)).toBe(1080);expect(png.readUInt32BE(20)).toBe(1080);});
});
