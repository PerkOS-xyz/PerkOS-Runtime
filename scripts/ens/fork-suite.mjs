import { writeFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, encodeFunctionData, parseAbi, zeroAddress, zeroHash } from 'viem';
import { sepolia } from 'viem/chains';
import { ENS_SEPOLIA as ENS, registryAbi, factoryAbi, helperAbi, resolverAbi, PROVISIONER_ROLES, REGISTRY_ROLES, prepareDeskMove, nextMoveStep, discoverDesk, evidenceHash, evidenceRecord, verifyEvidence, nextProvisionStep, applyProvisionReceipt, verifyDeskIdentity, recordCall, revokeCall, readText, instanceName, seatName, dnsName } from '../../packages/ens/dist/index.js';

if(process.env.ENS_REVIEW_MANAGED_FORK!=='1')throw new Error('Use run-fork.mjs');
const rpc='http://127.0.0.1:18547';
const client=createPublicClient({chain:sepolia,transport:http(rpc,{timeout:15000,retryCount:0}),cacheTime:0});
const report={scope:'isolated Sepolia fork; no public broadcasts',startedAt:new Date().toISOString(),checks:[],transactions:[]};
function check(name,pass){report.checks.push({name,pass});console.log(`${pass?'PASS':'FAIL'} ${name}`);if(!pass)throw new Error(name);}
async function send(account,call){const wallet=createWalletClient({account,chain:sepolia,transport:http(rpc)});const hash=await wallet.sendTransaction({...call,chain:sepolia,account});const receipt=await client.waitForTransactionReceipt({hash});if(receipt.status!=='success')throw new Error(`Transaction failed ${hash}`);report.transactions.push(hash);return receipt;}
async function contract(account,address,abi,functionName,args){return send(account,{to:address,data:encodeFunctionData({abi,functionName,args}),value:0n});}
async function reject(name,code,fn){try{await fn();}catch(e){check(name,e.message===code);return;}check(name,false);}
try{
 if(!(await client.request({method:'web3_clientVersion'})).toLowerCase().includes('anvil'))throw new Error('Requires Anvil');
 const accounts=await client.request({method:'eth_accounts'});
 const [operator,owner,...agents]=accounts.slice(0,9);
 for(const account of [operator,owner,...agents])await client.request({method:'anvil_setCode',params:[account,'0x']});
 report.block=String(await client.getBlockNumber());report.deployer=operator;
 check('Sepolia chain',await client.getChainId()===11155111);
 const rootLabel=process.env.ENS_REVIEW_LABEL||'ensv2-review-20260926';
 const registrar=parseAbi([
  'function makeCommitment(string label,address owner,bytes32 secret,address registry,address resolver,uint64 duration,bytes32 referrer) pure returns (bytes32)',
  'function commit(bytes32 commitment)',
  'function register(string label,address owner,bytes32 secret,address registry,address resolver,uint64 duration,address paymentToken,bytes32 referrer) returns (uint256)',
  'function isAvailable(string label) view returns (bool)',
 ]);
 const token='0x16f95d91dba7da3aca778ec053df0ff6c6a8aa8e';
 const tokenAbi=parseAbi(['function mint(address to,uint256 amount)','function approve(address spender,uint256 amount) returns (bool)']);
 check('Example parent is available',await client.readContract({address:ENS.ethRegistrar,abi:registrar,functionName:'isAvailable',args:[rootLabel]}));
 await contract(operator,token,tokenAbi,'mint',[operator,100_000_000n]);
 await contract(operator,token,tokenAbi,'approve',[ENS.ethRegistrar,100_000_000n]);
 const secret='0x'+'7a'.repeat(32),duration=31_536_000n;
 const commitment=await client.readContract({address:ENS.ethRegistrar,abi:registrar,functionName:'makeCommitment',args:[rootLabel,operator,secret,zeroAddress,zeroAddress,duration,zeroHash]});
 await contract(operator,ENS.ethRegistrar,registrar,'commit',[commitment]);
 await client.request({method:'evm_increaseTime',params:[120]});await client.request({method:'evm_mine',params:[]});
 await contract(operator,ENS.ethRegistrar,registrar,'register',[rootLabel,operator,secret,zeroAddress,zeroAddress,duration,token,zeroHash]);
 const init=encodeFunctionData({abi:registryAbi,functionName:'initialize',args:[[{account:operator,roleBitmap:PROVISIONER_ROLES|REGISTRY_ROLES.setSubregistry}]]});
 const simulated=await client.simulateContract({account:operator,address:ENS.factory,abi:factoryAbi,functionName:'deployProxy',args:[ENS.userRegistryImpl,303n,init]});
 const parentRegistry=simulated.result;
 await contract(operator,ENS.factory,factoryAbi,'deployProxy',[ENS.userRegistryImpl,303n,init]);
 const parentId=await client.readContract({address:ENS.ethRegistry,abi:registryAbi,functionName:'findTokenId',args:[rootLabel]});
 await contract(operator,ENS.ethRegistry,registryAbi,'setSubregistry',[parentId,parentRegistry]);
 await contract(operator,parentRegistry,registryAbi,'setParent',[ENS.ethRegistry,rootLabel]);
 const definitions=[['scout','scout-source'],['risk','risk-verdict'],['trader',null],['auditor','auditor-evidence'],['hooks','hooks-evidence'],['quote','quote-evidence'],['treasury','treasury-evidence']];
 const spec={mobile:true,parentName:rootLabel+'.eth',parentRegistry,label:'eqlty-instance-review',owner,seats:definitions.map(([id,writes],i)=>({id,label:id,agentId:'real-fixture-'+id,wallet:agents[i],context:'Public EQLTY '+id+' role',writes}))};
 report.parentName=spec.parentName;
 // Exercise bounded sponsorship instead of assuming every agent already has gas.
 await client.request({method:'anvil_setBalance',params:[agents[0],'0x0']});
 let progress={seats:{}},identity;
 const seen=[];
 for(let n=0;n<90;n++){
  const step=await nextProvisionStep(client,operator,spec,progress);
  if('done' in step){identity=step.done;break;}
  console.log('STEP',step.id);seen.push(step.id);
  const account=step.signer.kind==='operator'?operator:step.signer.wallet;
  const receipt=await send(account,{to:step.to,data:step.data,value:step.value});
  progress=applyProvisionReceipt(progress,step,receipt);
 }
 check('Production planner completes all seven seats',Boolean(identity));
 check('Agent without gas receives only the bounded initial sponsorship',seen.filter(x=>x==='fund:scout').length===1);
 check('Each seat gets a different resolver',new Set(identity.seats.map(s=>s.resolver)).size===7);
 check('Real receipt supplies every ERC-8004 registration ID',identity.seats.every(s=>BigInt(s.registrationId)>0n));
 const verified=await verifyDeskIdentity(client,identity);
 check('Canonical pointers and all seven ENSIP-25 associations verify',verified.verified&&verified.seats.length===7);
 check('Trader has no delegated ENS write',verified.seats.find(s=>s.id==='trader').writeGranted===false);
 check('Six evidence writers have their scoped grants',verified.seats.filter(s=>s.id!=='trader').every(s=>s.writeGranted));
 const name=instanceName(identity.label,identity.parentName),scout=identity.seats.find(s=>s.id==='scout');
 const write=await recordCall(client,identity,'scout','public-source:example');
 await send(scout.wallet,write);
 for(const seat of identity.seats.filter(s=>s.id!=='trader'&&s.id!=='scout')){
  await send(seat.wallet,await recordCall(client,identity,seat.id,'public-'+seat.id+'-evidence'));
  check(seat.id+' signs and resolves its own record',await readText(client,seatName(seat.id,name),seat.writes)==='public-'+seat.id+'-evidence');
 }
 const risk=identity.seats.find(s=>s.id==='risk');
 const guardedAbi=[...resolverAbi,...parseAbi(['error EACUnauthorizedAccountRoles(uint256 resource,uint256 roleBitmap,address account)'])];
 try {
  await client.simulateContract({account:scout.wallet,address:risk.resolver,abi:guardedAbi,functionName:'setText',args:[dnsName(seatName('risk',name)),'scout-source','forged']});
  check('Scout cannot publish through Risk resolver',false);
 } catch(error) {
  const decoded=error.walk?.(cause=>cause.data?.errorName)?.data?.errorName;
  if(decoded!=='EACUnauthorizedAccountRoles')throw error;
  check('Scout cannot publish through Risk resolver',true);
 }

 check('Agent-signed record resolves through the hierarchy',await readText(client,seatName('scout',name),'scout-source')==='public-source:example');
 await reject('Trader record is refused','ENS_SEAT_READ_ONLY',()=>recordCall(client,identity,'trader','no'));
 const packet={version:'1',type:'perkos-task-result',templateId:'eqlty-desk',decisionId:'fork-decision',taskId:'fork-task',role:'scout',agentId:scout.agentId,completedAt:new Date().toISOString(),response:'Fixture task response; no live agent executed this test.',quotes:[{chainId:4663,requestId:'complete-fixture-request-id',quotedAt:'2026-09-25T00:00:00Z',validUntil:'2026-09-25T00:02:00Z',tokenIn:operator,tokenOut:owner,amountIn:'1000000',amountOut:'2000000'}],identity:structuredClone(identity)};
 const evidenceCall=await recordCall(client,identity,'scout',evidenceRecord(evidenceHash(packet)));
 const published=await send(scout.wallet,evidenceCall);
 const envelope={packet,hash:evidenceHash(packet),transactionHash:published.transactionHash,blockNumber:String(published.blockNumber)};
 const checkedEvidence=await verifyEvidence(client,envelope);
 check('Exported packet proves hash, signer, transaction and historical identity',checkedEvidence.publication==='verified');
 check('Expired quote is identified separately from valid historical evidence',checkedEvidence.quoteStatus==='stale');
 await reject('Changed packet content is rejected','ENS_EVIDENCE_HASH_MISMATCH',()=>verifyEvidence(client,{...envelope,packet:{...packet,response:'altered'}}));
 const operatorWrite=await send(operator,evidenceCall);
 check('Operator cannot impersonate an agent publication',(await verifyEvidence(client,{...envelope,transactionHash:operatorWrite.transactionHash,blockNumber:String(operatorWrite.blockNumber)})).publication==='invalid');
 const revoke=await revokeCall(client,identity,'scout');await send(operator,revoke);
 await reject('Revoked Scout record is refused','ENS_WRITE_REVOKED',()=>recordCall(client,identity,'scout','after-revoke'));
 const revoked=await verifyDeskIdentity(client,identity);
 check('Revocation preserves identity but removes write permission',revoked.verified&&!revoked.seats.find(s=>s.id==='scout').writeGranted);
 const discovered=await discoverDesk(client,name);
 check('Desk is discovered and verified from ENS alone',discovered.verification.verified&&discovered.identity.seats.length===7);
 await reject('Cannot move under a descendant','ENS_MOVE_CYCLE',()=>prepareDeskMove(client,identity,operator,'child.'+name,'desk'));
 await reject('Old fixed identity requires explicit migration','ENS_FIXED_IDENTITY',()=>prepareDeskMove(client,{...identity,resolver:undefined},operator,spec.parentName,'fixed'));
 const destinationSalt=404n;
 const destination=await client.simulateContract({account:operator,address:ENS.factory,abi:factoryAbi,functionName:'deployProxy',args:[ENS.userRegistryImpl,destinationSalt,init]});
 await contract(operator,ENS.factory,factoryAbi,'deployProxy',[ENS.userRegistryImpl,destinationSalt,init]);
 const destinationRegistry=destination.result;
 const expiry=await client.readContract({address:ENS.ethRegistry,abi:registryAbi,functionName:'findExpiry',args:[rootLabel]});
 await contract(operator,parentRegistry,registryAbi,'register',['portfolio',operator,destinationRegistry,zeroAddress,REGISTRY_ROLES.setSubregistry,expiry]);
 await contract(operator,destinationRegistry,registryAbi,'setParent',[parentRegistry,'portfolio']);
 await reject('Occupied target cannot be overwritten','ENS_DESTINATION_OCCUPIED',()=>prepareDeskMove(client,identity,operator,spec.parentName,'portfolio'));
 await reject('A wallet without move authority cannot start','ENS_MOVE_AUTHORITY_REQUIRED',()=>prepareDeskMove(client,identity,owner,'portfolio.'+spec.parentName,'eqlty-moved'));
 const move=await prepareDeskMove(client,identity,operator,'portfolio.'+spec.parentName,'eqlty-moved');
 const snapshot=await client.request({method:'evm_snapshot',params:[]});
 await send(operator,await revokeCall(client,identity,'risk'));
 await reject('Permission changes during a move stop reconciliation','ENS_MOVE_BINDINGS_CHANGED',()=>nextMoveStep(client,operator,move));
 await client.request({method:'evm_revert',params:[snapshot]});
 const moveSteps=[];
 for(let n=0;n<35;n++){
  // JSON roundtrip models a restart, not an in-memory planner cursor.
  const step=await nextMoveStep(client,operator,JSON.parse(JSON.stringify(move)));
  if('done' in step){identity=step.done;break;}
  moveSteps.push(step.id);console.log('STEP',step.id);
  const account=step.signer.kind==='operator'?operator:step.signer.wallet;
  await send(account,{to:step.to,data:step.data,value:step.value});
 }
 check('Move completes with the same registry, wallets and registrations',identity.parentName===move.target.parentName&&identity.registry===move.source.registry&&JSON.stringify(identity.seats)===JSON.stringify(move.source.seats));
 const moved=await discoverDesk(client,instanceName(identity.label,identity.parentName));
 check('New name independently discovers the seven verified identities',moved.verification.verified&&moved.verification.seats.length===7);
 check('Revoked grant survives move',!moved.verification.seats.find(s=>s.id==='scout').writeGranted);
 check('No migration step grants or registers an agent',moveSteps.every(s=>!s.includes('grant')&&!s.includes('registration')));
 check('Old child pointer is detached',await client.readContract({address:parentRegistry,abi:registryAbi,functionName:'getSubregistry',args:[spec.label]})===zeroAddress);
 check('Historical evidence remains verifiable after revocation and move',(await verifyEvidence(client,envelope)).publication==='verified');
 check('Old name is no longer canonical',!(await verifyDeskIdentity(client,move.source)).verified);
 await reject('Revoked writer cannot publish at the new name','ENS_WRITE_REVOKED',()=>recordCall(client,identity,'scout','no'));
 check('Record bundles retain existing evidence',await readText(client,seatName('risk',instanceName(identity.label,identity.parentName)),'risk-verdict')==='public-risk-evidence');
 await send(risk.wallet,await recordCall(client,identity,'risk','after-move'));
 check('Authorized writer publishes after move',await readText(client,seatName('risk',instanceName(identity.label,identity.parentName)),'risk-verdict')==='after-move');
 const tokenId=await client.readContract({address:identity.parentRegistry,abi:registryAbi,functionName:'findTokenId',args:[identity.label]});
 await contract(owner,identity.parentRegistry,registryAbi,'setSubregistry',[tokenId,zeroAddress]);
 check('Detached subtree cannot verify',(await verifyDeskIdentity(client,identity)).verified===false);
 await reject('Detached subtree cannot publish','ENS_IDENTITY_CHANGED',()=>recordCall(client,identity,'risk','no'));
 report.identity=identity;report.verification=verified;report.steps=seen;report.status='passed';
}catch(e){report.status='failed';report.error=e.shortMessage||e.message;console.error(e);process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();writeFileSync(new URL('./fork-results.json',import.meta.url),JSON.stringify(report,(_,v)=>typeof v==='bigint'?String(v):v,2));console.log(report.status,report.checks.length,'checks',report.transactions.length,'local transactions');}
