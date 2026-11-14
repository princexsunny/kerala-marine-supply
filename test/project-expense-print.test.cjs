const test=require('node:test'),assert=require('node:assert/strict');
const {build}=require('../public/project-expense-print');
test('print report includes every project section and contractor with real balances',()=>{
 const p={schema:1,name:'Yard & Equipment',cost:10000000,loan:7000000,personal:2000000,company:1000000,bankMethod:'mixed',bankStages:[{id:'s',name:'Release one',kind:'percent',value:50,date:'2026-12-01',condition:'Inspection'}],receipts:[{id:'r',amount:2000000,source:'bank',stageId:'s',date:'2026-11-14',note:'Bank reference'}],contractors:['Steel team','Electrical team'].map((name,i)=>({id:'c'+i,name,work:'Work scope',amount:2000000,method:'milestones',stages:[{id:'p'+i,name:'Advance',kind:'fixed',value:500000,date:'',condition:'Agreement'}],payments:[{id:'pay'+i,date:'2026-11-14',amount:500000,stageId:'p'+i,note:'Payment reference'}]})),expenses:[{id:'e',date:'2026-11-14',amount:100000,bill:'B001',note:'Materials <script>bad</script>'}]};
 p.bankDivisions=[{id:'civil',name:'Civil work',kind:'fixed',value:5000000,bankShare:{kind:'percent',value:70}}];
 const html=build({project:p,updatedAt:'2026-11-14T10:00:00Z'},new Date('2026-11-14T11:00:00Z'));
 for(const text of ['Yard &amp; Equipment','Agreed funding','Bank release agreement','Money received','Contractors (2)','Steel team','Electrical team','Actual payments','Bills &amp; expenses','B001','Bank reference','Payment reference','50%','Inspection','Last saved:','IST'])assert(html.includes(text),text);
 assert(html.includes('Bank contribution'));assert(html.includes('My contribution'));assert(!html.includes('Company contribution'));assert(html.includes('₹35,000.00'));assert(!html.includes('<script>'));assert(html.includes('&lt;script&gt;'));assert(html.includes('₹9,000.00'));assert(html.includes('<strong class="money">'));assert(!html.includes('<button'));
});
test('empty sections are printable and project names are escaped',()=>{
 const p={schema:1,name:'<img src=x>',cost:0,loan:0,personal:0,company:0,bankMethod:'progress',bankStages:[],receipts:[],contractors:[],expenses:[]};const html=build({project:p});assert(html.includes('&lt;img src=x&gt;'));assert(!html.includes('<img'));assert(html.includes('None recorded.'));
});
