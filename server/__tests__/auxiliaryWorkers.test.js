'use strict';
const { startAuxiliaryWorkers, SERVICES } = require('../bootstrap/auxiliaryWorkers');
const { ApplicationRuntime } = require('../bootstrap/applicationRuntime');
const http = require('http');

test('the owned lifecycle names match the real service exports', () => {
  for (const [name, start, stop] of SERVICES) {
    const service = require(`../services/${name}`);
    expect(typeof service[start]).toBe('function');
    expect(typeof service[stop]).toBe('function');
  }
});

test('runtime owns post-listen workers and keeps resources open until every active pass drains', async () => {
  let release;
  const draining=new Promise(resolve=>{release=resolve;});
  const stops=SERVICES.map((_,index)=>jest.fn(()=>index===0?draining:Promise.resolve()));
  const workers={handles:[],stop(){return Promise.allSettled(this.handles.map(handle=>handle.stop()));}};
  const modules=Object.fromEntries(SERVICES.map(([name,start,stop],index)=>[name,{[start]:jest.fn(),[stop]:stops[index]}]));
  startAuxiliaryWorkers({workers,log:{warn:jest.fn()},load:name=>modules[name]});
  expect(workers.handles).toHaveLength(SERVICES.length);
  const pool={end:jest.fn()},redis={quit:jest.fn()},realtime={close:jest.fn()};
  const runtime=new ApplicationRuntime({httpServer:http.createServer(),pool,redis,realtime,workers,log:{info:jest.fn()}});
  const stopping=runtime.shutdown('test');await Promise.resolve();
  expect(stops.every(stop=>stop.mock.calls.length===1)).toBe(true);
  expect(pool.end).not.toHaveBeenCalled();expect(redis.quit).not.toHaveBeenCalled();
  release();await stopping;
  expect(pool.end).toHaveBeenCalledTimes(1);expect(redis.quit).toHaveBeenCalledTimes(1);
});

test('a partial auxiliary startup remains owned and does not prevent other workers from starting', async () => {
  const workers={handles:[]},warn=jest.fn(),starts=[],stop=jest.fn();
  startAuxiliaryWorkers({workers,log:{warn},load:name=>{
    const [,start,stopName]=SERVICES.find(row=>row[0]===name);
    return {[start]:()=>{starts.push(name);if(starts.length===1)throw Error('synthetic startup failure');},[stopName]:stop};
  }});
  expect(starts).toHaveLength(SERVICES.length);expect(warn).toHaveBeenCalledTimes(1);
  await Promise.all(workers.handles.map(handle=>handle.stop()));
  expect(stop).toHaveBeenCalledTimes(SERVICES.length);
});
