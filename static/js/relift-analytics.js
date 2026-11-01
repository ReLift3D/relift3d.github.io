/* GA4 is enabled only for the public project page, with a configured ReLift ID. */
(function () {
  'use strict';

  const measurementId = document.currentScript.dataset.measurementId;
  if (window.location.protocol !== 'https:' ||
      window.location.hostname !== 'relift3d.github.io' ||
      !/^G-[A-Z0-9]+$/.test(measurementId || '')) return;

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', measurementId);

  const tag = document.createElement('script');
  tag.async = true;
  tag.src = 'https://www.googletagmanager.com/gtag/js?id=' + measurementId;
  document.head.appendChild(tag);
})();
