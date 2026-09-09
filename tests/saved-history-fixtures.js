/* global window */
'use strict';

const PASSWORD = 'Synthetic-033-test-password!';

async function prepareSavedFixtures(page, suffix) {
  return page.evaluate(
    async ({ suffix, password }) => {
      const session = /** @type {any} */ (window).OrtbtoolsSession;
      const registered = await session.api('POST', 'api/auth/register', {
        email: `synthetic-033-${suffix}@example.invalid`,
        password,
      });
      session.setUser(registered.user);
      const crypto = await session.bootstrap(password);
      await session.api('POST', 'api/auth/setup-encryption', crypto.state);
      const partner = (await session.api('POST', 'api/partners', { name: 'Synthetic 033 partner' }))
        .partner;
      const req = JSON.stringify({
        id: 'synthetic-saved-033',
        site: { domain: 'saved.example' },
        imp: [{ id: 'i1', banner: { w: 300, h: 250 } }],
      });
      const encrypted = await session.encryptBlob(req);
      const saved = (
        await session.api('POST', 'api/samples', {
          title:
            'Synthetic encrypted ' + 'довга назва '.repeat(24) + '<img src=x onerror=alert(1)>',
          notes: 'Synthetic multiline notes\nOnly fixture data.',
          partner_id: partner.id,
          bid_req: encrypted.ct,
          req_iv: encrypted.iv,
          status: 'clean',
        })
      ).sample;
      const legacyReq = JSON.stringify({
        id: 'synthetic-legacy-saved-033',
        site: { domain: 'legacy-saved.example' },
        imp: [{ id: 'legacy-i1', banner: { w: 320, h: 50 } }],
      });
      const legacyRes = JSON.stringify({
        id: 'synthetic-legacy-saved-033',
        seatbid: [{ bid: [{ id: 'legacy-b1', impid: 'legacy-i1', price: 0.45 }] }],
      });
      const legacy = (
        await session.api('POST', 'api/samples', {
          title: 'Synthetic legacy 033',
          bid_req: legacyReq,
          bid_res: legacyRes,
          status: 'warnings',
        })
      ).sample;
      return {
        encryptedId: saved.id,
        legacyId: legacy.id,
        partnerId: partner.id,
        userId: registered.user.id,
        req,
        legacyReq,
        legacyRes,
      };
    },
    { suffix, password: PASSWORD },
  );
}

module.exports = { prepareSavedFixtures, PASSWORD };
