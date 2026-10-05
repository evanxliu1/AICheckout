// Extension page: tells the content script it loaded.
parent.postMessage({ aiCheckoutProbe: 'loaded' }, '*');
