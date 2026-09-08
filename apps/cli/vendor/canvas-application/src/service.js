const domain = require('../../canvas-domain/src');
const infra = require('../../canvas-infra-fs/src');
const { AppError, APP_ERROR_CODES } = require('./errors');
const { NoopSyncPort } = require('./syncPort');

class CanvasApplicationService {
  constructor(options) {
    this.ownerId = options && options.ownerId ? options.ownerId : `pid-${process.pid}`;
    this.nowProvider = options && options.nowProvider ? options.nowProvider : () => new Date();
    this.vaultRepo = options && options.vaultRepo ? options.vaultRepo : infra;
    this.lockService = options && options.lockService ? options.lockService : infra;
    this.journalService = options && options.journalService ? options.journalService : infra;
    this.backupService = options && options.backupService ? options.backupService : infra;
    this.syncPort = options && options.syncPort ? options.syncPort : new NoopSyncPort();
  }

  async initVault(input) {
    try {
      const vaultPath = requiredString(input && input.vaultPath, 'vaultPath');
      const name = requiredString(input && input.name, 'name');

      await this.vaultRepo.ensureVaultStructure(vaultPath);
      const metaPathExists = await hasFile(this.vaultRepo.getVaultMetaPath(vaultPath));
      if (!metaPathExists) {
        return await this.vaultRepo.initVault(vaultPath, name, this.nowProvider);
      }

      return await this.vaultRepo.loadVaultMetadata(vaultPath);
    } catch (error) {
      throw mapToAppError(error);
    }
  }

  async listCanvases(input) {
    try {
      const vaultPath = requiredString(input && input.vaultPath, 'vaultPath');
      await this.vaultRepo.ensureVaultStructure(vaultPath);
      const ids = await this.vaultRepo.listCanvasIds(vaultPath);
      return { canvases: ids };
    } catch (error) {
      throw mapToAppError(error);
    }
  }

  async createCanvas(input) {
    try {
      const vaultPath = requiredString(input && input.vaultPath, 'vaultPath');
      const canvasId = requiredString(input && input.canvasId, 'canvasId');
      const title = requiredString(input && input.title, 'title');

      await this.vaultRepo.ensureVaultStructure(vaultPath);
      if (await this.vaultRepo.hasCanvas(vaultPath, canvasId)) {
        throw new AppError(APP_ERROR_CODES.E_VALIDATION_FAILED, `canvas already exists: ${canvasId}`);
      }

      const snapshot = domain.createCanvas({ canvasId, title }, this.nowProvider);
      await this.vaultRepo.saveCanvasAtomic(vaultPath, snapshot);

      const vaultMetaExists = await hasFile(this.vaultRepo.getVaultMetaPath(vaultPath));
      if (!vaultMetaExists) {
        await this.vaultRepo.initVault(vaultPath, 'Zmind Vault', this.nowProvider);
      }

      const metadata = await this.vaultRepo.loadVaultMetadata(vaultPath);
      if (!metadata.defaultCanvasId) {
        metadata.defaultCanvasId = canvasId;
        metadata.updatedAt = this.nowProvider().toISOString();
        await this.vaultRepo.saveVaultMetadata(vaultPath, metadata);
      }

      return snapshot;
    } catch (error) {
      throw mapToAppError(error);
    }
  }

  async getCanvas(input) {
    try {
      const vaultPath = requiredString(input && input.vaultPath, 'vaultPath');
      const canvasId = requiredString(input && input.canvasId, 'canvasId');
      if (!(await this.vaultRepo.hasCanvas(vaultPath, canvasId))) {
        throw new AppError(APP_ERROR_CODES.E_NOT_FOUND, `canvas not found: ${canvasId}`);
      }
      return await this.vaultRepo.loadCanvas(vaultPath, canvasId);
    } catch (error) {
      throw mapToAppError(error);
    }
  }

  async addNode(input) {
    return this.#runWriteUseCase({
      input,
      operation: 'node.add',
      apply: (snapshot, payload) => domain.addNode(snapshot, payload, this.nowProvider),
      payload: {
        id: requiredString(input && input.nodeId, 'nodeId'),
        type: requiredString(input && input.nodeType, 'nodeType'),
        x: requiredNumber(input && input.x, 'x'),
        y: requiredNumber(input && input.y, 'y'),
        data: input && input.data ? input.data : {},
      },
    });
  }

  async updateNode(input) {
    return this.#runWriteUseCase({
      input,
      operation: 'node.update',
      apply: (snapshot, payload) => domain.updateNode(snapshot, payload, this.nowProvider),
      payload: {
        nodeId: requiredString(input && input.nodeId, 'nodeId'),
        patch: ensureObject(input && input.patch, 'patch'),
      },
    });
  }

  async addEdge(input) {
    return this.#runWriteUseCase({
      input,
      operation: 'edge.add',
      apply: (snapshot, payload) => domain.addEdge(snapshot, payload, this.nowProvider),
      payload: {
        id: requiredString(input && input.edgeId, 'edgeId'),
        from: requiredString(input && input.from, 'from'),
        to: requiredString(input && input.to, 'to'),
        type: input && input.edgeType ? String(input.edgeType) : 'arrow',
      },
    });
  }

  async updateEdge(input) {
    return this.#runWriteUseCase({
      input,
      operation: 'edge.update',
      apply: (snapshot, payload) => domain.updateEdge(snapshot, payload, this.nowProvider),
      payload: {
        edgeId: requiredString(input && input.edgeId, 'edgeId'),
        patch: ensureObject(input && input.patch, 'patch'),
      },
    });
  }

  async removeEdge(input) {
    return this.#runWriteUseCase({
      input,
      operation: 'edge.remove',
      apply: (snapshot, payload) => domain.removeEdge(snapshot, payload, this.nowProvider),
      payload: {
        edgeId: requiredString(input && input.edgeId, 'edgeId'),
      },
    });
  }

  async removeNode(input) {
    return this.#runWriteUseCase({
      input,
      operation: 'node.remove',
      apply: (snapshot, payload) => domain.removeNode(snapshot, payload, this.nowProvider),
      payload: {
        nodeId: requiredString(input && input.nodeId, 'nodeId'),
      },
    });
  }

  async replaceCanvas(input) {
    const payload = {};

    if (input && Object.prototype.hasOwnProperty.call(input, 'title')) {
      payload.title = String(input.title || '').trim();
    }
    if (input && Object.prototype.hasOwnProperty.call(input, 'nodes')) {
      payload.nodes = ensureArray(input.nodes, 'nodes');
    }
    if (input && Object.prototype.hasOwnProperty.call(input, 'edges')) {
      payload.edges = ensureArray(input.edges, 'edges');
    }
    if (input && Object.prototype.hasOwnProperty.call(input, 'metadata')) {
      payload.metadata = ensureObject(input.metadata, 'metadata');
    }

    return this.#runWriteUseCase({
      input,
      operation: 'canvas.replace',
      apply: (snapshot, writePayload) => domain.replaceCanvas(snapshot, writePayload, this.nowProvider),
      payload,
    });
  }

  async deleteCanvas(input) {
    const vaultPath = requiredString(input && input.vaultPath, 'vaultPath');
    const canvasId = requiredString(input && input.canvasId, 'canvasId');

    let token = null;
    try {
      token = await this.lockService.acquireLock({
        vaultPath,
        resourceId: canvasId,
        ownerId: this.ownerId,
        timeoutMs: 5000,
        ttlMs: 30000,
        pollMs: 30,
        nowProvider: this.nowProvider,
      });

      if (!(await this.vaultRepo.hasCanvas(vaultPath, canvasId))) {
        throw new AppError(APP_ERROR_CODES.E_NOT_FOUND, `canvas not found: ${canvasId}`);
      }

      const snapshot = await this.vaultRepo.loadCanvas(vaultPath, canvasId);
      domain.validateCanvasSnapshot(snapshot);

      await this.journalService.appendJournalEntry({
        vaultPath,
        canvasId,
        kind: 'intent',
        operation: 'canvas.delete',
        expectedRevision: snapshot.revision,
        nextRevision: snapshot.revision,
        payload: { canvasId },
        nowProvider: this.nowProvider,
      });

      await this.backupService.writeCanvasBackup({
        vaultPath,
        snapshot,
        nowProvider: this.nowProvider,
      });

      await this.vaultRepo.deleteCanvas(vaultPath, canvasId);
      await this.#refreshVaultDefaultCanvas(vaultPath, canvasId);

      await this.journalService.appendJournalEntry({
        vaultPath,
        canvasId,
        kind: 'commit',
        operation: 'canvas.delete',
        expectedRevision: snapshot.revision,
        nextRevision: snapshot.revision,
        payload: { result: 'ok' },
        nowProvider: this.nowProvider,
      });

      return { deleted: true, canvasId };
    } catch (error) {
      throw mapToAppError(error);
    } finally {
      await this.lockService.releaseLock(token).catch(() => {});
    }
  }

  async validate(input) {
    try {
      const vaultPath = requiredString(input && input.vaultPath, 'vaultPath');
      await this.vaultRepo.ensureVaultStructure(vaultPath);

      const canvasId = input && input.canvasId ? String(input.canvasId) : null;
      if (canvasId) {
        const snapshot = await this.getCanvas({ vaultPath, canvasId });
        domain.validateCanvasSnapshot(snapshot);
        return { valid: true, checked: [canvasId] };
      }

      const ids = await this.vaultRepo.listCanvasIds(vaultPath);
      for (const id of ids) {
        const snapshot = await this.vaultRepo.loadCanvas(vaultPath, id);
        domain.validateCanvasSnapshot(snapshot);
      }
      return { valid: true, checked: ids };
    } catch (error) {
      throw mapToAppError(error);
    }
  }

  async migrate(input) {
    try {
      const vaultPath = requiredString(input && input.vaultPath, 'vaultPath');
      const target = input && input.to ? String(input.to) : 'latest';
      if (target !== 'latest') {
        throw new AppError(APP_ERROR_CODES.E_USAGE, 'only --to latest is supported in v1');
      }

      const ids = await this.vaultRepo.listCanvasIds(vaultPath);
      let migrated = 0;

      for (const id of ids) {
        const snapshot = await this.vaultRepo.loadCanvas(vaultPath, id);
        if (snapshot.schemaVersion > domain.CURRENT_CANVAS_SCHEMA_VERSION) {
          throw new AppError(
            APP_ERROR_CODES.E_SCHEMA_UNSUPPORTED,
            `canvas ${id} schemaVersion ${snapshot.schemaVersion} is newer than supported ${domain.CURRENT_CANVAS_SCHEMA_VERSION}`
          );
        }

        if (snapshot.schemaVersion < domain.CURRENT_CANVAS_SCHEMA_VERSION) {
          snapshot.schemaVersion = domain.CURRENT_CANVAS_SCHEMA_VERSION;
          snapshot.updatedAt = this.nowProvider().toISOString();
          snapshot.revision += 1;
          await this.vaultRepo.saveCanvasAtomic(vaultPath, snapshot);
          migrated += 1;
        }
      }

      return {
        migrated,
        targetSchemaVersion: domain.CURRENT_CANVAS_SCHEMA_VERSION,
      };
    } catch (error) {
      throw mapToAppError(error);
    }
  }

  async syncPush(input) {
    try {
      const vaultPath = requiredString(input && input.vaultPath, 'vaultPath');
      const canvasId = requiredString(input && input.canvasId, 'canvasId');
      const snapshot = await this.getCanvas({ vaultPath, canvasId });
      return this.syncPort.push({ vaultPath, canvasId, snapshot });
    } catch (error) {
      throw mapToAppError(error);
    }
  }

  async syncPull(input) {
    try {
      const vaultPath = requiredString(input && input.vaultPath, 'vaultPath');
      const canvasId = requiredString(input && input.canvasId, 'canvasId');
      return this.syncPort.pull({ vaultPath, canvasId });
    } catch (error) {
      throw mapToAppError(error);
    }
  }

  async syncResolve(input) {
    try {
      const vaultPath = requiredString(input && input.vaultPath, 'vaultPath');
      const canvasId = requiredString(input && input.canvasId, 'canvasId');
      const strategy = requiredString(input && input.strategy, 'strategy');
      return this.syncPort.resolve({ vaultPath, canvasId, strategy });
    } catch (error) {
      throw mapToAppError(error);
    }
  }

  async #runWriteUseCase(options) {
    const { input, operation, payload, apply } = options;
    const vaultPath = requiredString(input && input.vaultPath, 'vaultPath');
    const canvasId = requiredString(input && input.canvasId, 'canvasId');
    const expectedRevision = optionalPositiveInteger(input && input.expectedRevision, 'expectedRevision');

    let token = null;
    try {
      token = await this.lockService.acquireLock({
        vaultPath,
        resourceId: canvasId,
        ownerId: this.ownerId,
        timeoutMs: 5000,
        ttlMs: 30000,
        pollMs: 30,
        nowProvider: this.nowProvider,
      });

      if (!(await this.vaultRepo.hasCanvas(vaultPath, canvasId))) {
        throw new AppError(APP_ERROR_CODES.E_NOT_FOUND, `canvas not found: ${canvasId}`);
      }

      const snapshot = await this.vaultRepo.loadCanvas(vaultPath, canvasId);
      domain.validateCanvasSnapshot(snapshot);

      if (expectedRevision !== null && snapshot.revision !== expectedRevision) {
        throw new AppError(APP_ERROR_CODES.E_REVISION_CONFLICT, 'revision conflict', {
          expectedRevision,
          currentRevision: snapshot.revision,
        });
      }

      await this.journalService.appendJournalEntry({
        vaultPath,
        canvasId,
        kind: 'intent',
        operation,
        expectedRevision: snapshot.revision,
        nextRevision: snapshot.revision + 1,
        payload,
        nowProvider: this.nowProvider,
      });

      const next = apply(snapshot, payload);
      domain.validateCanvasSnapshot(next);

      await this.backupService.writeCanvasBackup({
        vaultPath,
        snapshot,
        nowProvider: this.nowProvider,
      });

      await this.vaultRepo.saveCanvasAtomic(vaultPath, next);

      await this.journalService.appendJournalEntry({
        vaultPath,
        canvasId,
        kind: 'commit',
        operation,
        expectedRevision: snapshot.revision,
        nextRevision: next.revision,
        payload: { result: 'ok' },
        nowProvider: this.nowProvider,
      });

      return next;
    } catch (error) {
      throw mapToAppError(error);
    } finally {
      await this.lockService.releaseLock(token).catch(() => {});
    }
  }

  async #refreshVaultDefaultCanvas(vaultPath, removedCanvasId) {
    const metaPathExists = await hasFile(this.vaultRepo.getVaultMetaPath(vaultPath));
    if (!metaPathExists) {
      return;
    }

    const metadata = await this.vaultRepo.loadVaultMetadata(vaultPath);
    if (metadata.defaultCanvasId && metadata.defaultCanvasId !== removedCanvasId) {
      return;
    }

    const ids = await this.vaultRepo.listCanvasIds(vaultPath);
    metadata.defaultCanvasId = ids.length > 0 ? ids[0] : null;
    metadata.updatedAt = this.nowProvider().toISOString();
    await this.vaultRepo.saveVaultMetadata(vaultPath, metadata);
  }
}

function mapToAppError(error) {
  if (error instanceof AppError) {
    return error;
  }

  if (error && error.code === 'E_LOCK_TIMEOUT') {
    return new AppError(APP_ERROR_CODES.E_LOCK_TIMEOUT, error.message);
  }

  if (error instanceof domain.DomainError) {
    if (
      error.code === domain.DOMAIN_ERROR_CODES.NODE_NOT_FOUND
      || error.code === domain.DOMAIN_ERROR_CODES.EDGE_NOT_FOUND
    ) {
      return new AppError(APP_ERROR_CODES.E_NOT_FOUND, error.message, {
        domainCode: error.code,
        details: error.details || null,
      });
    }

    return new AppError(APP_ERROR_CODES.E_VALIDATION_FAILED, error.message, {
      domainCode: error.code,
      details: error.details || null,
    });
  }

  if (error && error.code === 'ENOENT') {
    return new AppError(APP_ERROR_CODES.E_NOT_FOUND, error.message);
  }

  if (error && ['EIO', 'EPERM', 'EACCES'].includes(error.code)) {
    return new AppError(APP_ERROR_CODES.E_IO_ATOMIC_WRITE_FAILED, error.message);
  }

  return new AppError(APP_ERROR_CODES.E_INTERNAL, error && error.message ? error.message : 'internal error');
}

function requiredString(value, field) {
  const v = String(value || '').trim();
  if (!v) {
    throw new AppError(APP_ERROR_CODES.E_USAGE, `${field} is required`);
  }
  return v;
}

function requiredNumber(value, field) {
  const n = Number(value);
  if (Number.isNaN(n)) {
    throw new AppError(APP_ERROR_CODES.E_USAGE, `${field} must be a number`);
  }
  return n;
}

function optionalPositiveInteger(value, field) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new AppError(APP_ERROR_CODES.E_USAGE, `${field} must be a positive integer`);
  }
  return n;
}

function ensureObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError(APP_ERROR_CODES.E_USAGE, `${field} must be an object`);
  }
  return value;
}

function ensureArray(value, field) {
  if (!Array.isArray(value)) {
    throw new AppError(APP_ERROR_CODES.E_USAGE, `${field} must be an array`);
  }
  return value;
}

async function hasFile(filePath) {
  const fs = require('fs');
  try {
    await fs.promises.access(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  CanvasApplicationService,
  mapToAppError,
};
