(function(root){
  'use strict';
  const sum=(items,key)=>items.reduce((n,x)=>n+x[key],0);
  const stageAmount=(stage,base)=>stage.kind==='percent'?Math.round(base*stage.value/100):stage.value;
  function totals(p){
    const bankReceived=sum(p.receipts.filter(r=>r.source==='bank'),'amount');
    const received=sum(p.receipts,'amount'),bills=sum(p.expenses,'amount');
    const contractorPaid=p.contractors.reduce((n,c)=>n+sum(c.payments,'amount'),0);
    return {funding:p.loan+p.personal+p.company,gap:p.cost-p.loan-p.personal-p.company,received,bankReceived,
      bankRemaining:p.loan-bankReceived,bills,contractorPaid,spent:bills+contractorPaid,balance:received-bills-contractorPaid,
      bankAllocated:p.bankStages.reduce((n,s)=>n+stageAmount(s,p.loan),0)};
  }
  function validate(p){
    const error=m=>{throw new Error(m);};
    const text=(v,n,required=false)=>{if(typeof v!=='string'||v.length>n||(required&&!v.trim()))error('Check the name or note.');};
    const money=v=>{if(!Number.isSafeInteger(v)||v<0||v>99999999900)error('Enter a valid amount (up to ₹99,99,99,999).');};
    const list=v=>{if(!Array.isArray(v)||v.length>1000)error('Too many items or invalid project data.');};
    const id=v=>{if(typeof v!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(v))error('Invalid item ID.');};
    const date=(v,required=false)=>{if(v===''&&!required)return;if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)error('Choose a valid date.');};
    const unique=rows=>{list(rows);const ids=new Set();for(const r of rows){id(r.id);if(ids.has(r.id))error('Duplicate item.');ids.add(r.id);}};
    const stages=(rows,base)=>{unique(rows);let fixed=0,percent=0;for(const s of rows){text(s.name,100,true);text(s.condition,500);date(s.date);if(s.kind==='percent'){if(!Number.isFinite(s.value)||s.value<=0||s.value>100||Math.abs(s.value*100-Math.round(s.value*100))>1e-6)error('Enter a percentage between 0.01 and 100.');percent+=s.value;}else if(s.kind==='fixed'){money(s.value);if(!s.value)error('Enter a stage amount.');fixed+=s.value;}else error('Choose percentage or fixed amount.');}if(percent>100.000001||fixed+base*percent/100>base+0.000001)error('Agreed stages exceed the loan or contractor amount. Reduce a stage or increase the agreement amount.');};
    const transactions=(rows,stageRows)=>{unique(rows);for(const r of rows){money(r.amount);if(!r.amount)error('Enter an amount above zero.');date(r.date,true);text(r.note,500);text(r.stageId,100);if(r.stageId&&!stageRows.some(s=>s.id===r.stageId))error('This payment refers to a missing stage.');}};
    if(!p||typeof p!=='object'||Array.isArray(p)||p.schema!==1)error('Invalid project.');
    text(p.name,100,true);['cost','loan','personal','company'].forEach(k=>money(p[k]));
    if(!['progress','bills','dates','mixed'].includes(p.bankMethod))error('Choose a bank release method.');
    if(p.bankDivisions!==undefined){list(p.bankDivisions);try{stages(p.bankDivisions.map(d=>({...d,date:'',condition:''})),p.loan);}catch(e){error('Bank loan division: '+e.message);}}
    stages(p.bankStages,p.loan);transactions(p.receipts,p.bankStages);
    for(const r of p.receipts){if(!['bank','personal','company'].includes(r.source))error('Choose a funding source.');if(r.source!=='bank'&&r.stageId)error('Only bank receipts can refer to bank stages.');}
    unique(p.contractors);for(const c of p.contractors){text(c.name,100,true);text(c.work,200);money(c.amount);if(!['milestones','measured','dates','mixed'].includes(c.method))error('Choose a contractor payment method.');stages(c.stages,c.amount);transactions(c.payments,c.stages);}
    unique(p.expenses);for(const e of p.expenses){money(e.amount);if(!e.amount)error('Enter an expense amount.');date(e.date,true);text(e.bill,80);text(e.note,200,true);}
    if(JSON.stringify(p).length>350000)error('This project is too large. Export a backup and start another project.');
    return p;
  }
  const api={totals,stageAmount,validate};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ProjectExpenseModel=api;
})(typeof window!=='undefined'?window:globalThis);
