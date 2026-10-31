const steps=[...document.querySelectorAll('.step')];
const states=[
  {label:'Your Mac',value:'193 GB used',number:'79%',core:'disk used',bars:['78%','58%','48%']},
  {label:'Explore by extension',value:'451,704 files',number:'42',core:'file types',bars:['92%','72%','61%']},
  {label:'Cleanup safely',value:'Ready to review',number:'25 GB',core:'selected',bars:['20%','12%','6%']}
];
function setState(i){steps.forEach((s,n)=>s.classList.toggle('active',n===i));const x=states[i];document.querySelector('#visualLabel').textContent=x.label;document.querySelector('#visualValue').textContent=x.value;document.querySelector('#coreNumber').textContent=x.number;document.querySelector('#coreLabel').textContent=x.core;document.querySelectorAll('.visual-rows i').forEach((b,n)=>b.style.width=x.bars[n]);document.querySelector('.orbit-ring').style.transform=`rotate(${i*120}deg) scale(${1-i*.06})`;document.querySelectorAll('.particle').forEach((p,n)=>p.style.transform=`rotate(${i*90+n*10}deg) translate(${i*8}px)`)}
const observer=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting)setState(Number(e.target.dataset.step))}),{threshold:.55});steps.forEach(s=>observer.observe(s));
