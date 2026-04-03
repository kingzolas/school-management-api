class NotificationDispatchService {
  constructor({ transports = {} } = {}) {
    this.transports = transports;
  }

  registerTransport(channel, transport) {
    this.transports[channel] = transport;
  }

  async assertReady(channel, context = {}) {
    const transport = this.transports[channel];

    if (!transport) {
      const error = new Error(`Transport not configured for channel: ${channel}`);
      error.code = 'TRANSPORT_NOT_CONFIGURED';
      throw error;
    }

    if (typeof transport.assertReady === 'function') {
      return transport.assertReady(context);
    }

    return true;
  }

  async dispatch({ notificationLog, invoice, school, config, message }) {
    const channel = notificationLog?.delivery_channel;
    const transport = this.transports[channel];

    if (!transport || typeof transport.send !== 'function') {
      const error = new Error(`Transport not configured for channel: ${channel}`);
      error.code = 'TRANSPORT_NOT_CONFIGURED';
      throw error;
    }

    return transport.send({
      notificationLog,
      invoice,
      school,
      config,
      message,
    });
  }
}

module.exports = NotificationDispatchService;
