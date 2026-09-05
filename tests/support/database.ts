import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import EmbeddedPostgres from "embedded-postgres";
import { Database } from "../../src/infrastructure/database.js";
import { migrate } from "../../src/infrastructure/migrations.js";

export async function testDatabase() {
  const external=process.env.TEST_DATABASE_URL;
  if(external){const url=new URL(external);if(!url.pathname.startsWith('/jumanji_test'))throw new Error('TEST_DATABASE_URL must name a jumanji_test database');const database=new Database(external);await migrate(database);return {database,url:external,stop:()=>database.close()};}
  const probe=createServer();await new Promise<void>(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=(probe.address() as {port:number}).port;await new Promise<void>(resolve=>probe.close(()=>resolve()));
  const directory=await mkdtemp(join(tmpdir(),'jumanji-test-'));
  const pg=new EmbeddedPostgres({databaseDir:join(directory,'postgres'),port,user:'jumanji',password:'isolated-test-only',persistent:true,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1'],onLog:()=>undefined,onError:()=>undefined});
  await pg.initialise();await pg.start();await pg.createDatabase('jumanji_test');
  const url=`postgresql://jumanji:isolated-test-only@127.0.0.1:${port}/jumanji_test`,database=new Database(url);
  try{await migrate(database);}catch(error){await database.close();await pg.stop();throw error;}
  return {database,url,directory,stop:async()=>{await database.close();await pg.stop();}};
}
