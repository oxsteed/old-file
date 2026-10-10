import React from 'react';

function House({ x, y, scale = 1, accent = '#bd5429' }) {
  return <g transform={`translate(${x} ${y}) scale(${scale})`} stroke="#403b38" strokeWidth="1.5" strokeLinejoin="round">
    <path d="M0 37 42 0 84 37" fill={accent} /><path d="M7 36 42 6 77 36V96H7Z" fill="#f5eee2" />
    <path d="M32 96V64h20v32" fill="#c68553" /><path d="M15 48h13v18H15zm42 0h13v18H57z" fill="#d6e1dd" />
    <path d="M21.5 48v18M15 57h13m35.5-9v18M57 57h13" fill="none" />
    <path d="M35 26a7 7 0 0 1 14 0v10H35Z" fill="#dce2df" /><path d="M42 19v17m-7-9h14" fill="none" />
    <path d="M60 11V-2h9v22" fill="#c68553" /><circle cx="47" cy="81" r="1" fill="#403b38" />
  </g>;
}
function Tree({ x, y, scale = 1 }) {
  return <g transform={`translate(${x} ${y}) scale(${scale})`} stroke="#746a58" strokeWidth="1.2"><path d="M0 54V8" /><path d="M0 31C-28 30-20-4 0-10c23 5 25 37 0 41Z" fill="#dedccc" /><path d="M0 36V0m0 19-9-9m9 17 10-11" fill="none" /></g>;
}
function Person({ x, y, color = '#c85325', flip = false }) {
  return <g transform={`translate(${x} ${y}) scale(${flip ? -1 : 1} 1)`} stroke="#3e3835" strokeWidth="1.2" strokeLinecap="round"><circle cy="-40" r="5" fill="#d39c75" /><path d="M-6-32h12l3 24H-9Z" fill={color} /><path d="m-4-8-3 27m10-27 5 27m-17-3h-6m23 3h6M-7-28l-9 16m22-16 14 14" fill="none" /></g>;
}

export default function MediaNeighborhoodArt({ kind = 'homes', className = '' }) {
  if (kind === 'business') return <svg className={className} viewBox="0 0 360 150" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <rect width="360" height="150" fill="#e8dfc9" /><path d="M0 28Q40-17 80 26t70 0v124H0Z" fill="#69847a" /><rect x="182" width="178" height="150" fill="#345b57" /><path d="M258 0h102v68H258Z" fill="#d7d4b7" />
    <rect x="32" y="44" width="240" height="106" fill="#c38760" /><rect x="38" y="40" width="230" height="10" fill="#f2e9d4" /><path d="M42 46h222l15 42H27Z" fill="#f8ead1" />
    {[0, 1, 2, 3, 4, 5].map(i => <path key={i} d={`M${45 + i * 39} 46h19l8 42h-24Z`} fill="#ad5027" />)}
    <rect x="48" y="99" width="58" height="51" fill="#284f50" /><rect x="121" y="99" width="57" height="51" fill="#e8c596" /><rect x="197" y="99" width="58" height="39" fill="#284f50" /><path d="M135 150v-44h31v44M216 99v39m-19-20h58" stroke="#f3e4c6" strokeWidth="3" fill="none" /><rect x="134" y="114" width="19" height="8" fill="#ac5937" />
  </svg>;
  if (kind === 'community') return <svg className={className} viewBox="0 0 360 150" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="360" height="150" fill="#ebe4d0" /><path d="M0 0h360v42Q290 77 213 34T0 45Z" fill="#667763" /><path d="m49 0 11 150m240-150-19 150" stroke="#795e44" strokeWidth="12" /><ellipse cx="181" cy="123" rx="91" ry="19" fill="#a77750" /><path d="m133 122-13 28m110-28 13 28" stroke="#704b35" strokeWidth="8" />{[70, 128, 194, 249, 294].map((x, i) => <g key={x} transform={`translate(${x} 80)`}><circle cy="-6" r="10" fill={i % 2 ? '#c99367' : '#d8a478'} /><path d="M-13 7h26l10 43H-20Z" fill={['#c55327', '#b9955b', '#28536e', '#e6e2ce', '#b97248'][i]} /><path d="m-9 48-8 31m28-31 17 31" stroke="#34495c" strokeWidth="9" /><path d="m-10 17-18 19m39-19 20 20" stroke="#d2a07d" strokeWidth="6" /></g>)}</svg>;
  if (kind === 'people') return <svg className={className} viewBox="0 0 180 115" aria-hidden="true"><rect x="18" y="17" width="145" height="92" rx="22" fill="#faf5e9" /><g stroke="#10162a" strokeWidth="2.4" fill="#fff"><circle cx="53" cy="49" r="10" /><circle cx="90" cy="41" r="12" fill="#c55322" /><circle cx="127" cy="49" r="10" /><path d="M35 101V83a18 18 0 0 1 36 0v18Zm73 0V83a18 18 0 0 1 36 0v18Z" /><path d="M68 106V79a22 22 0 0 1 44 0v27Z" fill="#c55322" /><path d="m90 15 0-12m-16 16-8-9m40 9 8-9m-54 27-11-4m70 4 11-4" fill="none" strokeLinecap="round" /></g></svg>;
  return <svg className={className} viewBox="0 18 360 140" aria-hidden="true"><path d="M24 126Q13 24 87 38t84-7 92-7 69 102Z" fill="#f3ecdf" /><Tree x={39} y={70} scale={0.9} /><Tree x={320} y={78} scale={0.85} /><House x={60} y={48} scale={0.91} accent="#82786a" /><House x={145} y={26} scale={1.05} /><House x={251} y={51} scale={0.82} /><path d="M13 137h334" stroke="#77776d" strokeWidth="1.3" /><path d="M29 137q9-21 22 0m242 0q16-24 31 0" fill="#94a281" stroke="#77776d" /><Person x={131} y={130} color="#e2dacb" /><Person x={148} y={136} color="#ba7c54" /><Person x={245} y={131} /></svg>;
}
