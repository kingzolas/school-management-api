const { normalizeWhatsappPhone } = require('../utils/timeContext');
const { normalizeString, normalizeEmail, getEmailIssueCode } = require('../utils/contact.util');

const CHANNEL_DEFAULTS = Object.freeze({
  whatsapp: {
    enabled: true,
    provider: 'evolution',
  },
  email: {
    enabled: false,
    provider: 'gmail',
  },
});

class NotificationChannelSelectorService {
  _toPlainObject(value) {
    if (!value || typeof value !== 'object') return {};
    if (typeof value.toObject === 'function') return value.toObject();
    if (value._doc && typeof value._doc === 'object') return { ...value._doc };
    return { ...value };
  }

  _normalizeConfig(config = {}) {
    const plainConfig = this._toPlainObject(config);
    const plainChannels = this._toPlainObject(plainConfig.channels);
    const plainWhatsapp = this._toPlainObject(plainChannels.whatsapp);
    const plainEmail = this._toPlainObject(plainChannels.email);

    const primaryChannel = normalizeString(plainConfig.primaryChannel) || 'whatsapp';
    const fallbackChannel = normalizeString(plainConfig.fallbackChannel) || null;
    const allowFallback = plainConfig.allowFallback === true;

    const channels = {
      whatsapp: {
        ...CHANNEL_DEFAULTS.whatsapp,
        ...plainWhatsapp,
      },
      email: {
        ...CHANNEL_DEFAULTS.email,
        ...plainEmail,
      },
    };

    return {
      primaryChannel,
      fallbackChannel,
      allowFallback,
      channels,
    };
  }

  _isPaused(channelConfig = {}) {
    if (channelConfig?.paused !== true) return false;

    const pausedUntil = normalizeString(channelConfig.pausedUntil) || channelConfig.pausedUntil || null;
    if (!pausedUntil) return true;

    const parsed = new Date(pausedUntil);
    if (Number.isNaN(parsed.getTime())) return true;
    return parsed > new Date();
  }

  _getAvailability(recipient = {}) {
    const phone = normalizeString(
      recipient.target_phone_normalized ||
      recipient.target_phone ||
      recipient?.recipient_snapshot?.phone_normalized ||
      recipient?.recipient_snapshot?.phone
    );

    const email = normalizeEmail(
      recipient.target_email_normalized ||
      recipient.target_email ||
      recipient?.recipient_snapshot?.email_normalized ||
      recipient?.recipient_snapshot?.email
    );
    const emailIssueCode = normalizeString(recipient?.email_issue_code) || getEmailIssueCode(email);

    return {
      whatsapp: {
        available: Boolean(phone && normalizeWhatsappPhone(phone)),
        target: phone ? normalizeWhatsappPhone(phone) : null,
        issue_code: normalizeString(recipient?.channel_issues?.whatsapp) || (phone ? null : 'RECIPIENT_PHONE_MISSING'),
      },
      email: {
        available: Boolean(email && !emailIssueCode),
        target: email && !emailIssueCode ? email : null,
        raw_target: email || null,
        issue_code: emailIssueCode,
      },
    };
  }

  _buildSuccessResult(channel, normalizedConfig, availability, resolutionReason, usedFallback) {
    return {
      channel,
      provider: normalizedConfig.channels[channel]?.provider || null,
      resolution_reason: resolutionReason,
      reason_code: 'CHANNEL_SELECTED',
      used_fallback: usedFallback,
      target: availability[channel]?.target || null,
      target_phone: channel === 'whatsapp' ? availability.whatsapp.target : null,
      target_email: channel === 'email' ? availability.email.target : null,
      available_channels: {
        whatsapp: availability.whatsapp.available,
        email: availability.email.available,
      },
      enabled_channels: {
        whatsapp: normalizedConfig.channels.whatsapp.enabled !== false,
        email: normalizedConfig.channels.email.enabled === true,
      },
    };
  }

  _resolveDisabledReason(channel) {
    return channel === 'email' ? 'EMAIL_CHANNEL_DISABLED' : 'WHATSAPP_CHANNEL_DISABLED';
  }

  _resolveUnavailableReason(channel, availability) {
    if (channel === 'email') {
      return availability.email.issue_code || 'RECIPIENT_EMAIL_MISSING';
    }

    return availability.whatsapp.issue_code || 'NO_CHANNEL_AVAILABLE';
  }

  _buildFailureResult(normalizedConfig, availability, resolutionReason, reasonCode) {
    return {
      channel: null,
      provider: null,
      resolution_reason: resolutionReason,
      reason_code: reasonCode,
      used_fallback: false,
      target: null,
      target_phone: null,
      target_email: null,
      available_channels: {
        whatsapp: availability.whatsapp.available,
        email: availability.email.available,
      },
      enabled_channels: {
        whatsapp: normalizedConfig.channels.whatsapp.enabled !== false,
        email: normalizedConfig.channels.email.enabled === true,
      },
    };
  }

  selectChannel({ config = {}, recipient = {}, preferredChannel = null } = {}) {
    const normalizedConfig = this._normalizeConfig(config);
    const availability = this._getAvailability(recipient);

    const primaryChannel = normalizeString(preferredChannel) || normalizedConfig.primaryChannel;
    const fallbackChannel = normalizedConfig.allowFallback
      ? (normalizedConfig.fallbackChannel || (primaryChannel === 'whatsapp' ? 'email' : 'whatsapp'))
      : null;

    const primaryEnabled = normalizedConfig.channels[primaryChannel]?.enabled === true ||
      (primaryChannel === 'whatsapp' && normalizedConfig.channels.whatsapp.enabled !== false);
    const primaryAvailable = availability[primaryChannel]?.available === true;
    const primaryPaused = this._isPaused(normalizedConfig.channels[primaryChannel]);

    if (primaryEnabled && !primaryPaused && primaryAvailable) {
      return this._buildSuccessResult(
        primaryChannel,
        normalizedConfig,
        availability,
        'primary_channel_available',
        false
      );
    }

    if (normalizedConfig.allowFallback && fallbackChannel && fallbackChannel !== primaryChannel) {
      const fallbackEnabled = normalizedConfig.channels[fallbackChannel]?.enabled === true ||
        (fallbackChannel === 'whatsapp' && normalizedConfig.channels.whatsapp.enabled !== false);
      const fallbackAvailable = availability[fallbackChannel]?.available === true;
      const fallbackPaused = this._isPaused(normalizedConfig.channels[fallbackChannel]);

      if (fallbackEnabled && !fallbackPaused && fallbackAvailable) {
        const reason = !primaryEnabled
          ? 'fallback_primary_disabled'
          : 'fallback_primary_unavailable';

        return this._buildSuccessResult(
          fallbackChannel,
          normalizedConfig,
          availability,
          reason,
          true
        );
      }
    }

    if (!primaryEnabled) {
      return this._buildFailureResult(
        normalizedConfig,
        availability,
        'primary_channel_disabled',
        this._resolveDisabledReason(primaryChannel)
      );
    }

    if (primaryPaused) {
      return this._buildFailureResult(
        normalizedConfig,
        availability,
        'primary_channel_paused',
        primaryChannel === 'email' ? 'EMAIL_CHANNEL_PAUSED' : 'TRANSPORT_NOT_CONFIGURED'
      );
    }

    if (!primaryAvailable) {
      return this._buildFailureResult(
        normalizedConfig,
        availability,
        'primary_channel_unavailable',
        this._resolveUnavailableReason(primaryChannel, availability)
      );
    }

    return this._buildFailureResult(normalizedConfig, availability, 'no_channel_selected', 'NO_CHANNEL_AVAILABLE');
  }
}

const service = new NotificationChannelSelectorService();

module.exports = service;
module.exports.NotificationChannelSelectorService = NotificationChannelSelectorService;
