// UI adapter only. All probability, level, and recipe search runs in native Rust.
self.onmessage = async function (event) {
  const message = event.data;
  if (message.type === 'init') { self.postMessage({type:'ready'}); return; }
  if (message.type === 'cancel') { await fetch('/api/cancel',{method:'POST'}); return; }
  if (message.type !== 'search') return;
  const params = {...message.params, exactCount: !!message.params.targets.exactCount};
  self.postMessage({type:'started',timestamp:Date.now()});
  try {
    const response = await fetch('/api/search?compact=1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(params)});
    if (!response.ok) throw new Error(await response.text());
    const result = await response.json();
    self.postMessage({type:'progress',data:{phase:'enumerated',total:result.survivors,logicalTotalCandidates:result.logicalTotal}});
    self.postMessage({type:'result-batch',rows:result.rows,compact:result.compact,materialNames:result.materialNames,labels:result.labels});
    self.postMessage({type:'progress',data:{phase:'evaluating',current:result.survivors,logicalResolved:result.cancelled?0:result.logicalTotal,recipesPerSecond:result.logicalTotal/(result.searchMs/1000)}});
    self.postMessage({type:result.cancelled?'cancelled':'done',searchMs:result.searchMs});
  } catch(error) { self.postMessage({type:'error',message:error.message}); }
};
