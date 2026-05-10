'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Router, matchPath } = require('../lib/router.js');

test('matchPath: exact match', () => {
  assert.deepEqual(matchPath('/api/health', '/api/health'), { params: {} });
  assert.equal(matchPath('/api/health', '/api/sample'), null);
});

test('matchPath: placeholder', () => {
  assert.deepEqual(matchPath('/api/samples/:id', '/api/samples/42'), {
    params: { id: '42' },
  });
  assert.equal(matchPath('/api/samples/:id', '/api/samples'), null);
  assert.equal(matchPath('/api/samples/:id', '/api/samples/42/extra'), null);
});

test('matchPath: trailing star prefix', () => {
  assert.deepEqual(matchPath('/api/behavior/corpus*', '/api/behavior/corpus'), {
    params: {},
    rest: '',
  });
  assert.deepEqual(matchPath('/api/behavior/corpus*', '/api/behavior/corpus/42'), {
    params: {},
    rest: '/42',
  });
  assert.equal(matchPath('/api/behavior/corpus*', '/api/health'), null);
});

test('Router.register + dispatch: basic flow', async () => {
  const router = new Router();
  /** @type {{ match: any, parsed: any } | null} */
  let calledWith = null;
  router.register({
    id: 'test',
    routes: [
      {
        method: 'POST',
        path: '/api/test/:id',
        handler: (req, res, parsed, match) => {
          calledWith = { match, parsed };
        },
      },
    ],
  });

  const parsed = new URL('http://localhost/api/test/abc');
  const handled = await router.dispatch({ method: 'POST' }, {}, parsed);
  assert.equal(handled, true);
  if (!calledWith) throw new Error('handler should have been called');
  assert.deepEqual(calledWith.match.params, { id: 'abc' });
});

test('Router.dispatch: no match returns false', async () => {
  const router = new Router();
  router.register({
    id: 'test',
    routes: [{ method: 'GET', path: '/api/x', handler: () => {} }],
  });
  const parsed = new URL('http://localhost/api/y');
  const handled = await router.dispatch({ method: 'GET' }, {}, parsed);
  assert.equal(handled, false);
});

test('Router.register: throws on invalid route', () => {
  const router = new Router();
  assert.throws(() => router.register({ id: 'bad', routes: [{ method: 'GET' }] }), /invalid route/);
});
