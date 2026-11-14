(function(){
'use strict';
const $=id=>document.getElementById(id),M=window.ProjectExpenseModel,clone=x=>JSON.parse(JSON.stringify(x)),uid=()=>crypto.randomUUID();
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>(n/100).toLocaleString('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2});
const sum=(xs,k)=>xs.reduce((n,x)=>n+x[k],0),today=()=>new Date().toLocaleDateString('en-CA');
const date=x=>x?new Date(x+'T12:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}):'—';
const bankMethods={progress:'Work progress',bills:'Submitted bills',dates:'Fixed dates',mixed:'Combination'};
const contractorMethods={milestones:'Work stages',measured:'Measured work',dates:'Fixed dates',mixed:'Combination'};
const sources={bank:'Bank',personal:'My contribution',company:'Company contribution'};
let list=[],record=null,tab='overview',contractorId=null,busy=false,onSave=null,saving=false;
function note(text,error=false){$('status').textContent=text;$('status').className=error?'error':'';}
async function api(path='',options={}){
 const response=await fetch('/api/expense-projects'+path,{...options,credentials:'same-origin',headers:{'Content-Type':'application/json',...options.headers}});
 if(response.status===401){location.href='/login.html?next='+encodeURIComponent('/expense-calculator.html');throw Error('Please sign in again.');}
 const body=await response.json();if(!response.ok)throw Error(body.error||'Could not save. Try again.');return body;
}
function setBusy(value){busy=value;$('project-select').disabled=value||!list.length;$('new-project').disabled=value;$('reload').disabled=value;}
function selection(){const select=$('project-select');select.innerHTML='<option value="">Select project…</option>'+list.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name)+'</option>').join('');select.value=record?.id||'';select.disabled=busy||!list.length;}
async function loadList(){setBusy(true);note('Loading projects…');try{list=await api();selection();note(list.length?'Choose a project.':'Ready. Add your first project.');}catch(e){note(e.message,true);$('empty').textContent='Projects could not be loaded. Use Refresh to try again.';throw e;}finally{setBusy(false);}}
let loadSequence=0;
async function loadProject(id){if(!id){record=null;render();return;}const sequence=++loadSequence;setBusy(true);note('Loading project…');try{const next=await api('/'+encodeURIComponent(id));if(sequence!==loadSequence)return;record=next;contractorId=null;render();note('Saved to your account.');history.replaceState({},'','?project='+encodeURIComponent(id));}catch(e){selection();note(e.message,true);}finally{if(sequence===loadSequence)setBusy(false);}}
async function persist(project,isNew=false){
 M.validate(project);setBusy(true);note('Saving…');
 try{const saved=await api(isNew?'':'/'+encodeURIComponent(record.id),{method:isNew?'POST':'PUT',body:JSON.stringify({project,revision:isNew?undefined:record.revision})});record=saved;if(isNew){tab='overview';contractorId=null;}
 const item={id:saved.id,name:saved.project.name,updatedAt:saved.updatedAt},i=list.findIndex(p=>p.id===saved.id);if(i<0)list.push(item);else list[i]=item;list.sort((a,b)=>a.name.localeCompare(b.name));selection();render();note('Saved to your account.');history.replaceState({},'','?project='+encodeURIComponent(saved.id));return saved;
 }catch(e){note(e.message,true);throw e;}finally{setBusy(false);}
}
const button=(action,label,id='',parent='')=>'<button type="button" data-action="'+action+'" data-id="'+esc(id)+'" data-parent="'+esc(parent)+'">'+label+'</button>';
const metric=(label,value,sub='')=>'<div class="metric"><span>'+esc(label)+'</span><strong>'+money(value)+'</strong><small>'+esc(sub)+'</small></div>';
const field=(name,label,type='text',value='',required=false)=>'<label>'+esc(label)+'<input name="'+name+'" type="'+type+'" value="'+esc(value)+'"'+(required?' required':'')+(type==='number'?' min="0" max="999999999" step="0.01" inputmode="decimal"':'')+(type==='text'?' maxlength="200"':'')+'></label>';
const amount=(name,label,value=0)=>field(name,label,'number',value?value/100:'');
const select=(name,label,options,value)=>'<label>'+esc(label)+'<select name="'+name+'">'+Object.entries(options).map(([k,v])=>'<option value="'+esc(k)+'"'+(k===value?' selected':'')+'>'+esc(v)+'</option>').join('')+'</select></label>';
function editor(title,fields,save){$('editor-title').textContent=title;$('editor-fields').innerHTML=fields;$('editor-error').textContent='';onSave=save;$('editor').showModal();}
function formValues(form){return Object.fromEntries(new FormData(form));}
function cents(v){const n=Number(String(v||'').replace(/,/g,''));if(!Number.isFinite(n)||n<0||Math.abs(n*100-Math.round(n*100))>0.00001)throw Error('Use positive amounts with up to two decimal places.');return Math.round(n*100);}
function projectEditor(isNew){const p=isNew?{schema:1,name:'',cost:0,loan:0,personal:0,company:0,bankMethod:'progress',bankStages:[],receipts:[],contractors:[],expenses:[]}:clone(record.project);
 editor(isNew?'New project':'Edit project',field('name','Project name','text',p.name,true)+amount('cost','Total project cost (₹)',p.cost)+amount('loan','Bank loan sanctioned (₹)',p.loan)+amount('personal','My contribution (₹)',p.personal)+amount('company','Company contribution (₹)',p.company)+select('bankMethod','Bank releases based on',bankMethods,p.bankMethod),async v=>{p.name=v.name.trim();for(const k of ['cost','loan','personal','company'])p[k]=cents(v[k]);p.bankMethod=v.bankMethod;await persist(p,isNew);});
}
function stageEditor(owner,id){const p=clone(record.project),c=owner?p.contractors.find(c=>c.id===owner):null,rows=c?c.stages:p.bankStages,base=c?c.amount:p.loan;
 const original=rows.find(s=>s.id===id),s=original||{id:uid(),name:'',kind:'percent',value:0,date:'',condition:''};
 editor((original?'Edit ':'Add ')+(c?'payment stage':'bank release stage'),field('name','Stage name','text',s.name,true)+select('kind','Agree as',{percent:'Percentage (%)',fixed:'Fixed amount (₹)'},s.kind)+field('value','Percentage or amount','number',s.kind==='fixed'?s.value/100:s.value,true)+field('date','Expected date (optional)','date',s.date)+field('condition','Work / condition (optional)','text',s.condition)+'<p class="muted wide">Percentage of '+esc(c?'contract amount':'sanctioned loan')+': '+money(base)+'.</p>',async v=>{Object.assign(s,{name:v.name.trim(),kind:v.kind,value:v.kind==='fixed'?cents(v.value):Number(v.value),date:v.date,condition:v.condition.trim()});if(!original)rows.push(s);await persist(p);});
}
function receiptEditor(id){const p=clone(record.project),original=p.receipts.find(r=>r.id===id),r=original||{id:uid(),date:today(),source:'bank',amount:0,stageId:'',note:''};
 editor(original?'Edit money received':'Record money received',select('source','Received from',sources,r.source)+amount('amount','Amount received (₹)',r.amount)+field('date','Received date','date',r.date,true)+select('stageId','Bank stage (optional)',Object.fromEntries([['','No stage / contribution'],...p.bankStages.map(s=>[s.id,s.name])]),r.stageId)+field('note','Note (optional)','text',r.note),async v=>{Object.assign(r,{source:v.source,amount:cents(v.amount),date:v.date,stageId:v.source==='bank'?v.stageId:'',note:v.note.trim()});if(!original)p.receipts.push(r);await persist(p);});
}
function contractorEditor(id){const p=clone(record.project),original=p.contractors.find(c=>c.id===id),c=original||{id:uid(),name:'',work:'',amount:0,method:'milestones',stages:[],payments:[]};
 editor(original?'Edit contractor':'Add contractor',field('name','Contractor name','text',c.name,true)+field('work','Work (optional)','text',c.work)+amount('amount','Agreed contract amount (₹)',c.amount)+select('method','Pay based on',contractorMethods,c.method),async v=>{Object.assign(c,{name:v.name.trim(),work:v.work.trim(),amount:cents(v.amount),method:v.method});if(!original)p.contractors.push(c);contractorId=c.id;await persist(p);});
}
function paymentEditor(owner,id){const p=clone(record.project),c=p.contractors.find(c=>c.id===owner),original=c.payments.find(r=>r.id===id),r=original||{id:uid(),date:today(),amount:0,stageId:'',note:''};
 editor(original?'Edit payment':'Pay '+c.name,amount('amount','Amount paid (₹)',r.amount)+field('date','Payment date','date',r.date,true)+select('stageId','Stage (optional)',Object.fromEntries([['','Advance / no stage'],...c.stages.map(s=>[s.id,s.name])]),r.stageId)+field('note','Note (optional)','text',r.note),async v=>{Object.assign(r,{amount:cents(v.amount),date:v.date,stageId:v.stageId,note:v.note.trim()});if(!original)c.payments.push(r);await persist(p);});
}
function expenseEditor(id){const p=clone(record.project),original=p.expenses.find(e=>e.id===id),e=original||{id:uid(),date:today(),bill:'',note:'',amount:0};
 editor(original?'Edit bill / expense':'Add bill / expense',field('note','Paid for','text',e.note,true)+amount('amount','Amount (₹)',e.amount)+field('date','Date','date',e.date,true)+field('bill','Bill no. (optional)','text',e.bill)+'<p class="muted wide">Record contractor payments under Contractors, so they are not counted twice.</p>',async v=>{Object.assign(e,{note:v.note.trim(),amount:cents(v.amount),date:v.date,bill:v.bill.trim()});if(!original)p.expenses.push(e);await persist(p);});
}
function table(headers,rows){return rows.length?'<div class="table-wrap"><table><thead><tr>'+headers.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(cells=>'<tr>'+cells.map(c=>'<td>'+c+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>':'<p class="empty">Nothing added yet.</p>';}
function stageTable(stages,base,transactions,owner=''){return table(['Stage / condition','Agreed','Received / paid','Balance','Due date',''],stages.map(s=>{const got=sum(transactions.filter(r=>r.stageId===s.id),'amount');return [esc(s.name)+(s.condition?'<br><small>'+esc(s.condition)+'</small>':''),'<span class="money">'+money(M.stageAmount(s,base))+'</span>'+(s.kind==='percent'?'<br><small>'+s.value+'%</small>':''),money(got),money(M.stageAmount(s,base)-got),date(s.date),button(owner?'contract-stage-edit':'bank-stage-edit','Edit',s.id,owner)];}));}
function receiptTable(p){return table(['Date','Source','Stage / note','Received',''],p.receipts.map(r=>[date(r.date),esc(sources[r.source]),esc(p.bankStages.find(s=>s.id===r.stageId)?.name||r.note||'—'),money(r.amount),button('receipt-edit','Edit',r.id)]));}
function paymentTable(c){return table(['Date','Stage / note','Paid',''],c.payments.map(r=>[date(r.date),esc(c.stages.find(s=>s.id===r.stageId)?.name||r.note||'Advance / no stage'),money(r.amount),button('payment-edit','Edit',r.id,c.id)]));}
function render(){
 $('empty').hidden=!!record;$('workspace').hidden=!record;$('export').hidden=!record;if(!record)return;
 const p=record.project,t=M.totals(p);$('project-title').textContent=p.name;
 $('metrics').innerHTML=metric('Project cost',p.cost)+metric('Money received',t.received,'Bank + personal + company')+metric('Spent',t.spent,'Bills + contractor payments')+metric('Cash balance',t.balance,t.balance<0?'Spent more than received':'Received minus spent');
 const warnings=[];if(t.gap>0)warnings.push('Funding still to arrange: '+money(t.gap));if(t.gap<0)warnings.push('Planned funding exceeds project cost by '+money(-t.gap));if(t.spent>p.cost)warnings.push('Spending exceeds project cost by '+money(t.spent-p.cost));if(t.bankRemaining<0)warnings.push('Bank receipts exceed the sanctioned loan by '+money(-t.bankRemaining));
 for(const c of p.contractors)if(sum(c.payments,'amount')>c.amount)warnings.push(c.name+': paid above agreed amount.');
 $('warnings').innerHTML=warnings.map(s=>'<div class="notice warning">'+esc(s)+'</div>').join('');
 for(const b of document.querySelectorAll('[data-tab]'))b.setAttribute('aria-selected',String(b.dataset.tab===tab));
 let html='';
 if(tab==='overview')html='<section class="card"><div class="head"><h2>Agreed funding</h2>'+button('receipt-add','+ Money received')+'</div>'+table(['Source','Agreed','Received'],[['Bank loan',money(p.loan),money(t.bankReceived)],['My contribution',money(p.personal),money(sum(p.receipts.filter(r=>r.source==='personal'),'amount'))],['Company contribution',money(p.company),money(sum(p.receipts.filter(r=>r.source==='company'),'amount'))]])+'<p class="muted">Agreed funding is a plan. Record money received to update the cash balance.</p></section><section class="card"><div class="head"><h2>Money received</h2></div>'+receiptTable(p)+'</section>';
 if(tab==='bank')html='<section class="card"><div class="head"><div><h2>Bank release agreement</h2><small>'+esc(bankMethods[p.bankMethod])+' · Loan '+money(p.loan)+'</small></div>'+button('bank-stage-add','+ Release stage')+'</div>'+stageTable(p.bankStages,p.loan,p.receipts.filter(r=>r.source==='bank'))+'<p class="muted">Agreed: '+money(t.bankAllocated)+' · Unallocated: '+money(p.loan-t.bankAllocated)+'</p></section><section class="card"><div class="head"><h2>Money received</h2>'+button('receipt-add','+ Money received')+'</div>'+receiptTable(p)+'</section>';
 if(tab==='contractors'){
 const c=p.contractors.find(c=>c.id===contractorId);
 if(!c)html='<section class="card"><div class="head"><h2>Contractors</h2>'+button('contractor-add','+ Add contractor')+'</div><div class="contractors">'+(p.contractors.length?p.contractors.map(c=>'<article class="card"><h3>'+esc(c.name)+'</h3><p class="muted">'+esc(c.work||contractorMethods[c.method])+'</p><p>Agreed <b>'+money(c.amount)+'</b><br>Paid '+money(sum(c.payments,'amount'))+'<br>Balance '+money(c.amount-sum(c.payments,'amount'))+'</p>'+button('contractor-open','Open',c.id)+'</article>').join(''):'<p class="empty">Add a contractor and set their payment agreement.</p>')+'</div></section>';
 else html=button('contractors-back','← All contractors')+'<section class="card"><div class="head"><div><h2>'+esc(c.name)+'</h2><small>'+esc(c.work)+' · '+esc(contractorMethods[c.method])+'</small></div>'+button('contractor-edit','Edit agreement',c.id)+'</div><p>Contract <b>'+money(c.amount)+'</b> · Paid '+money(sum(c.payments,'amount'))+' · Balance '+money(c.amount-sum(c.payments,'amount'))+'</p></section><section class="card"><div class="head"><h2>Payment agreement</h2>'+button('contract-stage-add','+ Payment stage','',c.id)+'</div>'+stageTable(c.stages,c.amount,c.payments,c.id)+'<p class="muted">Unallocated: '+money(c.amount-c.stages.reduce((n,s)=>n+M.stageAmount(s,c.amount),0))+'</p></section><section class="card"><div class="head"><h2>Actual payments</h2>'+button('payment-add','+ Record payment','',c.id)+'</div>'+paymentTable(c)+'<p class="muted">These payments already count as spending. Do not enter them again under Bills & expenses.</p></section>';
 }
 if(tab==='expenses')html='<section class="card"><div class="head"><h2>Bills & expenses</h2>'+button('expense-add','+ Add bill / expense')+'</div>'+table(['Date','Paid for','Bill no.','Amount',''],p.expenses.map(e=>[date(e.date),esc(e.note),esc(e.bill||'—'),money(e.amount),button('expense-edit','Edit',e.id)]))+'</section>';
 $('content').innerHTML=html;
}
$('editor-form').onsubmit=async event=>{event.preventDefault();if(saving)return;saving=true;$('save-editor').disabled=true;$('cancel-editor').disabled=true;$('editor-error').textContent='';try{await onSave(formValues(event.target));$('editor').close();}catch(e){$('editor-error').textContent=e.message;}finally{saving=false;$('save-editor').disabled=false;$('cancel-editor').disabled=false;}};
$('cancel-editor').onclick=()=>$('editor').close();$('editor').addEventListener('cancel',e=>{if(saving)e.preventDefault();});
$('new-project').onclick=()=>projectEditor(true);$('edit-project').onclick=()=>projectEditor(false);
$('project-select').onchange=()=>loadProject($('project-select').value);
$('reload').onclick=async()=>{const id=record?.id;try{await loadList();if(id)await loadProject(id);}catch{}};
document.querySelector('.tabs').onclick=e=>{const b=e.target.closest('[data-tab]');if(b&&!busy){tab=b.dataset.tab;contractorId=null;render();}};
$('content').onclick=e=>{const b=e.target.closest('[data-action]');if(!b||busy)return;const id=b.dataset.id,parent=b.dataset.parent;
 switch(b.dataset.action){case 'bank-stage-add':stageEditor();break;case 'bank-stage-edit':stageEditor('',id);break;case 'receipt-add':receiptEditor();break;case 'receipt-edit':receiptEditor(id);break;case 'contractor-add':contractorEditor();break;case 'contractor-edit':contractorEditor(id);break;case 'contractor-open':contractorId=id;render();break;case 'contractors-back':contractorId=null;render();break;case 'contract-stage-add':stageEditor(parent);break;case 'contract-stage-edit':stageEditor(parent,id);break;case 'payment-add':paymentEditor(parent);break;case 'payment-edit':paymentEditor(parent,id);break;case 'expense-add':expenseEditor();break;case 'expense-edit':expenseEditor(id);break;}
};
$('export').onclick=()=>{const blob=new Blob([JSON.stringify(record,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='project-'+record.id+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
window.addEventListener('beforeunload',e=>{if($('editor').open){e.preventDefault();e.returnValue='';}});
void loadList().then(()=>{const id=new URLSearchParams(location.search).get('project');if(id&&list.some(p=>p.id===id))return loadProject(id);if(list.length===1)return loadProject(list[0].id);}).catch(()=>{});
})();
