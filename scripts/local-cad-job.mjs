import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {basename,dirname,join,resolve} from 'node:path';

const loopback=new Set(['127.0.0.1','::1','::ffff:127.0.0.1']);
export function localCadRequest(request){
 const origin=request.headers.origin;
 return loopback.has(request.socket.remoteAddress)&&(!origin||origin===`http://${request.headers.host}`);
}

export function cadJobSignal(response){
 const controller=new AbortController();
 response.once('close',()=>controller.abort());
 return controller.signal;
}

export async function createCadJobDirectory(cache,prefix){
 const root=resolve(cache);
 await mkdir(root,{recursive:true});
 return mkdtemp(join(root,prefix));
}

export async function removeCadJobDirectory(directory,cache,prefix){
 const target=resolve(directory);
 if(dirname(target)!==resolve(cache)||!basename(target).startsWith(prefix))
  throw Error('CAD 作业目录不属于临时目录');
 await rm(target,{recursive:true,force:true});
}
