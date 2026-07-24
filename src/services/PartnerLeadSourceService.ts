import mongoose from 'mongoose';

interface PartnerLeadDocument {
  leadId?: string;
  addedBy?: string;
  addedByName?: string;
  source?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface PartnerLeadSource {
  leadId: string;
  addedBy?: string;
  addedByName?: string | null;
  source?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

function normalizePhone(raw?: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildLoosePhoneSuffixRegex(phoneDigits: string): RegExp {
  return new RegExp(`${phoneDigits.split('').map(escapeRegExp).join('\\D*')}$`);
}

export async function lookupPartnerLeadSource(params: {
  uid?: string | null;
  email?: string | null;
  phone?: string | null;
}): Promise<PartnerLeadSource | null> {
  const uid = params.uid?.trim();
  const email = params.email?.trim().toLowerCase();
  const phone = normalizePhone(params.phone);
  const conditions: Array<Record<string, unknown>> = [];

  if (uid) {
    conditions.push(
      { 'conversionData.platformUid': uid },
      { 'activationData.firebaseUid': uid }
    );
  }

  if (email) {
    conditions.push({ email });
  }

  if (phone) {
    const looseSuffixRegex = buildLoosePhoneSuffixRegex(phone);
    conditions.push(
      { phone },
      { landline: phone },
      { phone: `+91${phone}` },
      { landline: `+91${phone}` },
      { phone: `91${phone}` },
      { landline: `91${phone}` },
      { phone: looseSuffixRegex },
      { landline: looseSuffixRegex }
    );
  }

  if (conditions.length === 0) {
    return null;
  }

  const lead = await mongoose.connection
    .collection<PartnerLeadDocument>('leads')
    .findOne(
      { $or: conditions },
      {
        projection: {
          leadId: 1,
          addedBy: 1,
          addedByName: 1,
          source: 1,
          createdAt: 1,
          updatedAt: 1,
        },
        sort: { updatedAt: -1 },
      }
    );

  if (!lead?.leadId) {
    return null;
  }

  return {
    leadId: lead.leadId,
    addedBy: lead.addedBy,
    addedByName: lead.addedByName || null,
    source: lead.source || null,
    createdAt: lead.createdAt,
    updatedAt: lead.updatedAt,
  };
}
