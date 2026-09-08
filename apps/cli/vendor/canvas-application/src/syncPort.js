class SyncPort {
  async push(_payload) {
    throw new Error('sync push is not implemented');
  }

  async pull(_payload) {
    throw new Error('sync pull is not implemented');
  }

  async resolve(_payload) {
    throw new Error('sync resolve is not implemented');
  }
}

class NoopSyncPort extends SyncPort {
  async push(payload) {
    return {
      enabled: false,
      action: 'push',
      reason: 'sync adapter is not configured',
      payload,
    };
  }

  async pull(payload) {
    return {
      enabled: false,
      action: 'pull',
      reason: 'sync adapter is not configured',
      payload,
    };
  }

  async resolve(payload) {
    return {
      enabled: false,
      action: 'resolve',
      reason: 'sync adapter is not configured',
      payload,
    };
  }
}

module.exports = {
  SyncPort,
  NoopSyncPort,
};
