import { computeCloud } from './cloud-math.mjs';

self.onmessage = ({ data }) => {
  try { self.postMessage({ id: data.id, result: computeCloud(data.records, data.options) }); }
  catch (error) { self.postMessage({ id: data.id, error: error.message }); }
};
