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

test('matchPath: multi-placeholder path', () => {
  assert.deepEqual(matchPath('/api/orgs/:org/users/:id', '/api/orgs/myorg/users/123'), {
    params: { org: 'myorg', id: '123' },
  });
  assert.equal(matchPath('/api/orgs/:org/users/:id', '/api/orgs/myorg/users'), null);
  assert.equal(matchPath('/api/orgs/:org/users/:id', '/api/orgs/myorg/items/123'), null);
});

test('matchPath: URI-decoded placeholder value', () => {
  assert.deepEqual(matchPath('/api/users/:id', '/api/users/john%20doe'), {
    params: { id: 'john doe' },
  });
});

test('matchPath: trailing-star prefix-only false positive', () => {
  // pattern /api/foo* matches /api/foobar because startsWith('/api/foo') is true
  assert.deepEqual(matchPath('/api/foo*', '/api/foobar'), {
    params: {},
    rest: 'bar',
  });
});

test('Router.register: accepts an array of modules', async () => {
  const router = new Router();
  let calledA = false;
  let calledB = false;
  const modA = {
    id: 'a',
    routes: [{ method: 'GET', path: '/a', handler: () => { calledA = true; } }],
  };
  const modB = {
    id: 'b',
    routes: [{ method: 'GET', path: '/b', handler: () => { calledB = true; } }],
  };
  router.register([modA, modB]);

  await router.dispatch({ method: 'GET' }, {}, new URL('http://localhost/a'));
  assert.equal(calledA, true);
  assert.equal(calledB, false);

  calledA = false;
  await router.dispatch({ method: 'GET' }, {}, new URL('http://localhost/b'));
  assert.equal(calledA, false);
  assert.equal(calledB, true);
});

test('Router.register: silently skips falsy or route-less modules', async () => {
  const router = new Router();
  let called = false;
  const valid = {
    id: 'valid',
    routes: [{ method: 'GET', path: '/ok', handler: () => { called = true; } }],
  };
  // falsy module, module without routes array, module with non-array routes
  router.register([null, undefined, {}, { id: 'noRoutes' }, valid]);
  await router.dispatch({ method: 'GET' }, {}, new URL('http://localhost/ok'));
  assert.equal(called, true);
});

test('Router.register: throws on missing method', () => {
  const router = new Router();
  assert.throws(() => router.register({
    id: 'bad',
    routes: [{ path: '/x', handler: () => {} }],
  }), /invalid route/);
});

test('Router.register: throws on missing handler', () => {
  const router = new Router();
  assert.throws(() => router.register({
    id: 'bad',
    routes: [{ method: 'GET', path: '/x' }],
  }), /invalid route/);
});

test('Router.register: throws on handler not a function', () => {
  const router = new Router();
  assert.throws(() => router.register({
    id: 'bad',
    routes: [{ method: 'GET', path: '/x', handler: 'notafn' }],
  }), /invalid route/);
});

test('Router.match: POST route does not match GET on same path', () => {
  const router = new Router();
  router.register({
    id: 'test',
    routes: [{ method: 'POST', path: '/api/test', handler: () => {} }],
  });
  assert.equal(router.match('GET', '/api/test'), null);
  assert.notEqual(router.match('POST', '/api/test'), null);
});

test('Router.dispatch: first-match-wins when two routes overlap', async () => {
  const router = new Router();
  let firstCalled = false;
  let secondCalled = false;
  router.register({
    id: 'first',
    routes: [{ method: 'GET', path: '/api/overlap', handler: () => { firstCalled = true; } }],
  });
  router.register({
    id: 'second',
    routes: [{ method: 'GET', path: '/api/overlap', handler: () => { secondCalled = true; } }],
  });
  await router.dispatch({ method: 'GET' }, {}, new URL('http://localhost/api/overlap'));
  assert.equal(firstCalled, true);
  assert.equal(secondCalled, false);
});

test('Router.dispatch: handler that throws propagates error', async () => {
  const router = new Router();
  router.register({
    id: 'err',
    routes: [{
      method: 'GET',
      path: '/err',
      handler: () => { throw new Error('boom'); },
    }],
  });
  await assert.rejects(
    () => router.dispatch({ method: 'GET' }, {}, new URL('http://localhost/err')),
    /boom/,
  );
});
