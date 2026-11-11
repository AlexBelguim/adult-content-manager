import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { Provider } from 'react-redux';
import store from './redux/store';
import * as serviceWorkerRegistration from './utils/serviceWorkerRegistration';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <Provider store={store}>
    <App />
  </Provider>
);

// The service worker (src/service-worker.js): the app opens without the network and shows offline.html when the
// server cannot be reached. A new build waits until the "Update ready" notice (pwa/UpdateNotice.js) reloads the app.
serviceWorkerRegistration.register();
