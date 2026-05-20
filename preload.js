'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  products: {
    getAll:  ()      => ipcRenderer.invoke('products:getAll'),
    search:  (q)     => ipcRenderer.invoke('products:search', q),
    getById: (id)    => ipcRenderer.invoke('products:getById', id),
    quotePrice: (d)  => ipcRenderer.invoke('products:quotePrice', d),
    save:    (p)     => ipcRenderer.invoke('products:save', p),
    delete:  (id)    => ipcRenderer.invoke('products:delete', id),
  },
  productLots: {
    getByProduct:   (id)    => ipcRenderer.invoke('productLots:getByProduct', id),
    getExpiring:    (days)  => ipcRenderer.invoke('productLots:getExpiring', days),
    setPromotion:   (data)  => ipcRenderer.invoke('productLots:setPromotion', data),
    clearPromotion: (id)    => ipcRenderer.invoke('productLots:clearPromotion', id),
    add:            (lot)   => ipcRenderer.invoke('productLots:add', lot),
  },
  movements: {
    getAll:  (f)   => ipcRenderer.invoke('movements:getAll', f),
    getById: (id)  => ipcRenderer.invoke('movements:getById', id),
    save:    (mv)  => ipcRenderer.invoke('movements:save', mv),
    delete:  (id)  => ipcRenderer.invoke('movements:delete', id),
  },
  cashRegister: {
    getStatus:         ()      => ipcRenderer.invoke('cashRegister:getStatus'),
    open:              (data)  => ipcRenderer.invoke('cashRegister:open', data),
    close:             (data)  => ipcRenderer.invoke('cashRegister:close', data),
    getSessionSummary: (id)    => ipcRenderer.invoke('cashRegister:getSessionSummary', id),
    getHistory:        (limit) => ipcRenderer.invoke('cashRegister:getHistory', limit),
  },
  sales: {
    create:   (sd)     => ipcRenderer.invoke('sales:create', sd),
    cancel:   (id)     => ipcRenderer.invoke('sales:cancel', id),
    getItems: (id)     => ipcRenderer.invoke('sales:getItems', id),
  },
  reports: {
    daily:     (date)        => ipcRenderer.invoke('reports:daily', date),
    salesHistory: (filters)  => ipcRenderer.invoke('reports:salesHistory', filters),
    movements: (filters)     => ipcRenderer.invoke('reports:movements', filters),
    range:     (start, end)  => ipcRenderer.invoke('reports:range', start, end),
    exportSales: (filters)   => ipcRenderer.invoke('reports:exportSales', filters),
  },
  settings: {
    getAll:   ()           => ipcRenderer.invoke('settings:getAll'),
    get:      (key)        => ipcRenderer.invoke('settings:get', key),
    save:     (key, value) => ipcRenderer.invoke('settings:save', key, value),
    saveMany: (obj)        => ipcRenderer.invoke('settings:saveMany', obj),
  },
  auth: {
    hasPassword: ()     => ipcRenderer.invoke('auth:hasPassword'),
    setPassword: (data) => ipcRenderer.invoke('auth:setPassword', data),
    verify:      (pw)   => ipcRenderer.invoke('auth:verify', pw),
  },
  license: {
    getStatus: ()      => ipcRenderer.invoke('license:getStatus'),
    activate:  (key)   => ipcRenderer.invoke('license:activate', key),
    clear:     ()      => ipcRenderer.invoke('license:clear'),
  },
  email:  {
    test:       ()  => ipcRenderer.invoke('email:test'),
    sendReport: (r) => ipcRenderer.invoke('email:sendReport', r),
  },
  backup: {
    create:     ()  => ipcRenderer.invoke('backup:create'),
    getHistory: ()  => ipcRenderer.invoke('backup:getHistory'),
    getDir:     ()  => ipcRenderer.invoke('backup:getDir'),
  },
  app: {
    openFolder:     (path) => ipcRenderer.invoke('app:openFolder', path),
    showMessageBox: (opts) => ipcRenderer.invoke('app:showMessageBox', opts),
    getVersion:     ()     => ipcRenderer.invoke('app:getVersion'),
  },
});
