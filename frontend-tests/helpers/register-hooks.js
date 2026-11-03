import { registerHooks } from 'node:module';

// Swaps CDN imports (Leaflet) for an empty module so map.js loads without a network.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('https://')) return { url: 'data:text/javascript,', shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
