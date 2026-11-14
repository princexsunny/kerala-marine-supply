(function(root){
 'use strict';
 const M=typeof module!=='undefined'&&module.exports?require('./project-expense-model'):root.ProjectExpenseModel;
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=n=>'<strong class="money">'+esc((n/100).toLocaleString('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2}))+'</strong>';
 const sum=(xs,k)=>xs.reduce((n,x)=>n+x[k],0);
 const date=x=>x?esc(new Date(x+'T12:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})):'—';
 const table=(headers,rows)=>rows.length?'<table><thead><tr>'+headers.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(c=>'<td>'+c+'</td>').join('')+'</tr>').join('')+'</tbody></table>':'<p class="muted">None recorded.</p>';
 const stages=(rows,base,actual)=>table(['Stage','Agreed','Received / paid','Balance','Due date','Condition'],rows.map(s=>{const paid=sum(actual.filter(r=>r.stageId===s.id),'amount'),agreed=M.stageAmount(s,base);return [esc(s.name)+(s.kind==='percent'?' ('+s.value+'%)':''),money(agreed),money(paid),money(agreed-paid),date(s.date),esc(s.condition||'—')];}));
 const sources={bank:'Bank loan',personal:'My contribution',company:'Earlier funding receipt'};
 const bankMethods={progress:'Work progress',bills:'Submitted bills',dates:'Fixed dates',mixed:'Combination'};
 const contractorMethods={milestones:'Work stages',measured:'Measured work',dates:'Fixed dates',mixed:'Combination'};
 function build(record,printedAt=new Date()){
  const p=record.project,t=M.totals(p);M.validate(p);
  let html='<div class="report-heading"><p>SHALOM GROUP · KERALA MARINE SUPPLY</p><h1>'+esc(p.name)+'</h1><h2>Project expense report</h2><p>Printed: '+esc(printedAt.toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}))+' IST'+(record.updatedAt?' · Last saved: '+esc(new Date(record.updatedAt).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}))+' IST':'')+'</p></div>';
  html+='<h2>Summary</h2>'+table(['Project cost','Money received','Total spent','Cash balance'],[[money(p.cost),money(t.received),money(t.spent),money(t.balance)]])+'<p class="muted">Spending includes bills and contractor payments once. Cash balance is money received minus actual spending.</p>';
  if(t.gap)html+='<p class="report-warning">'+(t.gap>0?'Funding still to arrange: ':'Planned funding exceeds project cost by ')+money(Math.abs(t.gap))+'</p>';
  if(t.spent>p.cost)html+='<p class="report-warning">Spending exceeds project cost by '+money(t.spent-p.cost)+'</p>';
  html+='<h2>Agreed funding</h2>'+table(['Source','Agreed','Received','Still to receive'],[['bank',p.loan],['personal',p.personal]].map(([source,planned])=>{const received=sum(p.receipts.filter(r=>r.source===source),'amount');return [sources[source],money(planned),money(received),money(planned-received)];}));
  if((p.bankDivisions||[]).length){const splits=p.bankDivisions.map(d=>M.divisionFunding(d,p));html+='<h2>Cost division</h2>'+table(['Division','Total cost','Bank contribution','My contribution'],p.bankDivisions.map((d,i)=>[esc(d.name),money(splits[i].total),splits[i].bank===null?'Not set':money(splits[i].bank),splits[i].mine===null?'Not set':money(splits[i].mine)]).concat([['<b>Total</b>',money(sum(splits,'total')),money(splits.reduce((n,s)=>n+(s.bank||0),0)),money(splits.reduce((n,s)=>n+(s.mine||0),0))]]))+(splits.some(s=>s.bank===null)?'<p>Contribution totals include completed splits only; unset divisions need review.</p>':'');}
  const ft=M.fundingTotals(p);html+='<h2>Funding &amp; expenses</h2>'+table(['Source','Money received','Spent','Balance'],['personal','bank'].map(source=>[source==='bank'?'Bank money':'My money',money(ft[source].received),money(ft[source].spent),money(ft[source].balance)]))+(ft.unassigned?'<p>Earlier spending awaiting source: '+money(ft.unassigned)+'</p>':'')+table(['Date','Paid for','Division','My money','Bank money'],M.spending(p).map(r=>[date(r.date),esc(r.description),esc(r.division||'—'),r.funding?money(r.funding.personal):'Not assigned',r.funding?money(r.funding.bank):'Not assigned']));
  html+='<h2>Bank release agreement</h2><p>Release basis: '+esc(bankMethods[p.bankMethod])+'. Sanctioned: '+money(p.loan)+'. Unallocated: '+money(p.loan-t.bankAllocated)+'.</p>'+stages(p.bankStages,p.loan,p.receipts.filter(r=>r.source==='bank'));
  html+='<h2>Money received</h2>'+table(['Date','Source','Bank stage','Note','Amount'],p.receipts.map(r=>[date(r.date),sources[r.source],esc(p.bankStages.find(s=>s.id===r.stageId)?.name||'—'),esc(r.note||'—'),money(r.amount)]));
  html+='<h2>Contractors ('+p.contractors.length+')</h2>';
  if(!p.contractors.length)html+='<p class="muted">None recorded.</p>';
  for(const c of p.contractors){const paid=sum(c.payments,'amount');html+='<section class="report-contractor"><h3>'+esc(c.name)+'</h3><p>'+esc(c.work||'Work not specified')+' · Payment basis: '+esc(contractorMethods[c.method])+'</p>'+table(['Contract amount','Paid','Remaining'],[[money(c.amount),money(paid),money(c.amount-paid)]])+'<h4>Payment agreement</h4>'+stages(c.stages,c.amount,c.payments)+'<h4>Actual payments</h4>'+table(['Date','Stage','Note','Paid'],c.payments.map(r=>[date(r.date),esc(c.stages.find(s=>s.id===r.stageId)?.name||'Advance / no stage'),esc(r.note||'—'),money(r.amount)]))+'</section>';}
  html+='<h2>Bills &amp; expenses</h2>'+table(['Date','Bill no.','Paid for','Amount'],p.expenses.map(e=>[date(e.date),esc(e.bill||'—'),esc(e.note),money(e.amount)]));
  html+='<p class="report-total">Bills: '+money(t.bills)+' · Contractor payments: '+money(t.contractorPaid)+' · Total spending: '+money(t.spent)+'</p><p class="report-footer">Private project record · '+esc(p.name)+'</p>';
  return html;
 }
 if(typeof module!=='undefined'&&module.exports)module.exports={build};else root.ProjectExpensePrint={build};
})(typeof window!=='undefined'?window:globalThis);
