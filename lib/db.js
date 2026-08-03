/**
 * IndexedDB 操作封装 - ImageCollectorDB
 * 用法: const db = await getDB(); db.getAllImages(); etc.
 */
class ImageCollectorDB {
  constructor() {
    this.db = null;
  }

  async open() {
    if (this.db) return this.db;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('ImageCollectorDB', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('images')) {
          const store = db.createObjectStore('images', { keyPath: 'id', autoIncrement: true });
          store.createIndex('url', 'url', { unique: false });
          store.createIndex('category', 'category', { unique: false });
          store.createIndex('tags', 'tags', { unique: false, multiEntry: true });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };
    });
  }

  async addImage(imageData) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('images', 'readwrite');
      const store = tx.objectStore('images');
      const record = { ...imageData, createdAt: Date.now(), updatedAt: Date.now() };
      const req = store.add(record);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async getAllImages() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('images', 'readonly');
      const store = tx.objectStore('images');
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async getAllImageSummaries() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('images', 'readonly');
      const store = tx.objectStore('images');
      const images = [];
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve(images);
          return;
        }

        const image = { ...cursor.value };
        image.hasLocalFile = !!image.imageData;
        delete image.imageData;
        images.push(image);
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
  }

  async getImage(id) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('images', 'readonly');
      const store = tx.objectStore('images');
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async updateImage(id, updates) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('images', 'readwrite');
      const store = tx.objectStore('images');
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const record = getReq.result;
        if (!record) return reject(new Error('Not found'));
        const updated = { ...record, ...updates, updatedAt: Date.now() };
        const putReq = store.put(updated);
        putReq.onsuccess = () => resolve(updated);
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  }

  async deleteImage(id) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('images', 'readwrite');
      const store = tx.objectStore('images');
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async deleteAllImages() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('images', 'readwrite');
      const store = tx.objectStore('images');
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
}

const dbInstance = new ImageCollectorDB();

async function getDB() {
  return dbInstance;
}
