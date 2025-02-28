/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

// Polyfills for test environment
global.ReadableStream =
  require('web-streams-polyfill/ponyfill/es6').ReadableStream;
global.TextDecoder = require('util').TextDecoder;

// Don't wait before processing work on the server.
// TODO: we can replace this with FlightServer.act().
global.setImmediate = cb => cb();

let act;
let use;
let clientExports;
let clientModuleError;
let webpackMap;
let Stream;
let React;
let ReactDOM;
let ReactDOMClient;
let ReactServerDOMServer;
let ReactServerDOMClient;
let ReactDOMFizzServer;
let Suspense;
let ErrorBoundary;

describe('ReactFlightDOM', () => {
  beforeEach(() => {
    jest.resetModules();
    act = require('internal-test-utils').act;
    const WebpackMock = require('./utils/WebpackMock');
    clientExports = WebpackMock.clientExports;
    clientModuleError = WebpackMock.clientModuleError;
    webpackMap = WebpackMock.webpackMap;

    Stream = require('stream');
    React = require('react');
    ReactDOM = require('react-dom');
    ReactDOMFizzServer = require('react-dom/server.node');
    use = React.use;
    Suspense = React.Suspense;
    ReactDOMClient = require('react-dom/client');
    ReactServerDOMClient = require('react-server-dom-webpack/client');
    ReactServerDOMServer = require('react-server-dom-webpack/server.node.unbundled');

    ErrorBoundary = class extends React.Component {
      state = {hasError: false, error: null};
      static getDerivedStateFromError(error) {
        return {
          hasError: true,
          error,
        };
      }
      render() {
        if (this.state.hasError) {
          return this.props.fallback(this.state.error);
        }
        return this.props.children;
      }
    };
  });

  function getTestStream() {
    const writable = new Stream.PassThrough();
    const readable = new ReadableStream({
      start(controller) {
        writable.on('data', chunk => {
          controller.enqueue(chunk);
        });
        writable.on('end', () => {
          controller.close();
        });
      },
    });
    return {
      readable,
      writable,
    };
  }

  const theInfinitePromise = new Promise(() => {});
  function InfiniteSuspend() {
    throw theInfinitePromise;
  }

  it('should resolve HTML using Node streams', async () => {
    function Text({children}) {
      return <span>{children}</span>;
    }
    function HTML() {
      return (
        <div>
          <Text>hello</Text>
          <Text>world</Text>
        </div>
      );
    }

    function App() {
      const model = {
        html: <HTML />,
      };
      return model;
    }

    const {writable, readable} = getTestStream();
    const {pipe} = ReactServerDOMServer.renderToPipeableStream(
      <App />,
      webpackMap,
    );
    pipe(writable);
    const response = ReactServerDOMClient.createFromReadableStream(readable);
    const model = await response;
    expect(model).toEqual({
      html: (
        <div>
          <span>hello</span>
          <span>world</span>
        </div>
      ),
    });
  });

  // @gate enableUseHook
  it('should resolve the root', async () => {
    // Model
    function Text({children}) {
      return <span>{children}</span>;
    }
    function HTML() {
      return (
        <div>
          <Text>hello</Text>
          <Text>world</Text>
        </div>
      );
    }
    function RootModel() {
      return {
        html: <HTML />,
      };
    }

    // View
    function Message({response}) {
      return <section>{use(response).html}</section>;
    }
    function App({response}) {
      return (
        <Suspense fallback={<h1>Loading...</h1>}>
          <Message response={response} />
        </Suspense>
      );
    }

    const {writable, readable} = getTestStream();
    const {pipe} = ReactServerDOMServer.renderToPipeableStream(
      <RootModel />,
      webpackMap,
    );
    pipe(writable);
    const response = ReactServerDOMClient.createFromReadableStream(readable);

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<App response={response} />);
    });
    expect(container.innerHTML).toBe(
      '<section><div><span>hello</span><span>world</span></div></section>',
    );
  });

  // @gate enableUseHook
  it('should not get confused by $', async () => {
    // Model
    function RootModel() {
      return {text: '$1'};
    }

    // View
    function Message({response}) {
      return <p>{use(response).text}</p>;
    }
    function App({response}) {
      return (
        <Suspense fallback={<h1>Loading...</h1>}>
          <Message response={response} />
        </Suspense>
      );
    }

    const {writable, readable} = getTestStream();
    const {pipe} = ReactServerDOMServer.renderToPipeableStream(
      <RootModel />,
      webpackMap,
    );
    pipe(writable);
    const response = ReactServerDOMClient.createFromReadableStream(readable);

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<App response={response} />);
    });
    expect(container.innerHTML).toBe('<p>$1</p>');
  });

  // @gate enableUseHook
  it('should not get confused by @', async () => {
    // Model
    function RootModel() {
      return {text: '@div'};
    }

    // View
    function Message({response}) {
      return <p>{use(response).text}</p>;
    }
    function App({response}) {
      return (
        <Suspense fallback={<h1>Loading...</h1>}>
          <Message response={response} />
        </Suspense>
      );
    }

    const {writable, readable} = getTestStream();
    const {pipe} = ReactServerDOMServer.renderToPipeableStream(
      <RootModel />,
      webpackMap,
    );
    pipe(writable);
    const response = ReactServerDOMClient.createFromReadableStream(readable);

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<App response={response} />);
    });
    expect(container.innerHTML).toBe('<p>@div</p>');
  });

  // @gate enableUseHook
  it('should be able to esm compat test module references', async () => {
    const ESMCompatModule = {
      __esModule: true,
      default: function ({greeting}) {
        return greeting + ' World';
      },
      hi: 'Hello',
    };

    function Print({response}) {
      return <p>{use(response)}</p>;
    }

    function App({response}) {
      return (
        <Suspense fallback={<h1>Loading...</h1>}>
          <Print response={response} />
        </Suspense>
      );
    }

    function interopWebpack(obj) {
      // Basically what Webpack's ESM interop feature testing does.
      if (typeof obj === 'object' && obj.__esModule) {
        return obj;
      }
      return Object.assign({default: obj}, obj);
    }

    const {default: Component, hi} = interopWebpack(
      clientExports(ESMCompatModule),
    );

    const {writable, readable} = getTestStream();
    const {pipe} = ReactServerDOMServer.renderToPipeableStream(
      <Component greeting={hi} />,
      webpackMap,
    );
    pipe(writable);
    const response = ReactServerDOMClient.createFromReadableStream(readable);

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<App response={response} />);
    });
    expect(container.innerHTML).toBe('<p>Hello World</p>');
  });

  // @gate enableUseHook
  it('should be able to render a named component export', async () => {
    const Module = {
      Component: function ({greeting}) {
        return greeting + ' World';
      },
    };

    function Print({response}) {
      return <p>{use(response)}</p>;
    }

    function App({response}) {
      return (
        <Suspense fallback={<h1>Loading...</h1>}>
          <Print response={response} />
        </Suspense>
      );
    }

    const {Component} = clientExports(Module);

    const {writable, readable} = getTestStream();
    const {pipe} = ReactServerDOMServer.renderToPipeableStream(
      <Component greeting={'Hello'} />,
      webpackMap,
    );
    pipe(writable);
    const response = ReactServerDOMClient.createFromReadableStream(readable);

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<App response={response} />);
    });
    expect(container.innerHTML).toBe('<p>Hello World</p>');
  });

  // @gate enableUseHook
  it('should be able to render a module split named component export', async () => {
    const Module = {
      // This gets split into a separate module from the original one.
      split: function ({greeting}) {
        return greeting + ' World';
      },
    };

    function Print({response}) {
      return <p>{use(response)}</p>;
    }

    function App({response}) {
      return (
        <Suspense fallback={<h1>Loading...</h1>}>
          <Print response={response} />
        </Suspense>
      );
    }

    const {split: Component} = clientExports(Module);

    const {writable, readable} = getTestStream();
    const {pipe} = ReactServerDOMServer.renderToPipeableStream(
      <Component greeting={'Hello'} />,
      webpackMap,
    );
    pipe(writable);
    const response = ReactServerDOMClient.createFromReadableStream(readable);

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<App response={response} />);
    });
    expect(container.innerHTML).toBe('<p>Hello World</p>');
  });

  // @gate enableUseHook
  it('should unwrap async module references', async () => {
    const AsyncModule = Promise.resolve(function AsyncModule({text}) {
      return 'Async: ' + text;
    });

    const AsyncModule2 = Promise.resolve({
      exportName: 'Module',
    });

    function Print({response}) {
      return <p>{use(response)}</p>;
    }

    function App({response}) {
      return (
        <Suspense fallback={<h1>Loading...</h1>}>
          <Print response={response} />
        </Suspense>
      );
    }

    const AsyncModuleRef = await clientExports(AsyncModule);
    const AsyncModuleRef2 = await clientExports(AsyncModule2);

    const {writable, readable} = getTestStream();
    const {pipe} = ReactServerDOMServer.renderToPipeableStream(
      <AsyncModuleRef text={AsyncModuleRef2.exportName} />,
      webpackMap,
    );
    pipe(writable);
    const response = ReactServerDOMClient.createFromReadableStream(readable);

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<App response={response} />);
    });
    expect(container.innerHTML).toBe('<p>Async: Module</p>');
  });

  // @gate enableUseHook
  it('should unwrap async module references using use', async () => {
    const AsyncModule = Promise.resolve('Async Text');

    function Print({response}) {
      return use(response);
    }

    function App({response}) {
      return (
        <Suspense fallback={<h1>Loading...</h1>}>
          <Print response={response} />
        </Suspense>
      );
    }

    const AsyncModuleRef = clientExports(AsyncModule);

    function ServerComponent() {
      const text = use(AsyncModuleRef);
      return <p>{text}</p>;
    }

    const {writable, readable} = getTestStream();
    const {pipe} = ReactServerDOMServer.renderToPipeableStream(
      <ServerComponent />,
      webpackMap,
    );
    pipe(writable);
    const response = ReactServerDOMClient.createFromReadableStream(readable);

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<App response={response} />);
    });
    expect(container.innerHTML).toBe('<p>Async Text</p>');
  });

  // @gate enableUseHook
  it('should be able to import a name called "then"', async () => {
    const thenExports = {
      then: function then() {
        return 'and then';
      },
    };

    function Print({response}) {
      return <p>{use(response)}</p>;
    }

    function App({response}) {
      return (
        <Suspense fallback={<h1>Loading...</h1>}>
          <Print response={response} />
        </Suspense>
      );
    }

    const ThenRef = clientExports(thenExports).then;

    const {writable, readable} = getTestStream();
    const {pipe} = ReactServerDOMServer.renderToPipeableStream(
      <ThenRef />,
      webpackMap,
    );
    pipe(writable);
    const response = ReactServerDOMClient.createFromReadableStream(readable);

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<App response={response} />);
    });
    expect(container.innerHTML).toBe('<p>and then</p>');
  });

  it('throws when accessing a member below the client exports', () => {
    const ClientModule = clientExports({
      Component: {deep: 'thing'},
    });
    function dotting() {
      return ClientModule.Component.deep;
    }
    expect(dotting).toThrowError(
      'Cannot access Component.deep on the server. ' +
        'You cannot dot into a client module from a server component. ' +
        'You can only pass the imported name through.',
    );
  });

  it('does not throw when React inspects any deep props', () => {
    const ClientModule = clientExports({
      Component: function () {},
    });
    <ClientModule.Component key="this adds instrumentation" />;
  });

  it('throws when accessing a Context.Provider below the client exports', () => {
    const Context = React.createContext();
    const ClientModule = clientExports({
      Context,
    });
    function dotting() {
      return ClientModule.Context.Provider;
    }
    expect(dotting).toThrowError(
      `Cannot render a Client Context Provider on the Server. ` +
        `Instead, you can export a Client Component wrapper ` +
        `that itself renders a Client Context Provider.`,
    );
  });

  // @gate enableUseHook
  it('should progressively reveal server components', async () => {
    let reportedErrors = [];

    // Client Components

    function MyErrorBoundary({children}) {
      return (
        <ErrorBoundary
          fallback={e => (
            <p>
              {__DEV__ ? e.message + ' + ' : null}
              {e.digest}
            </p>
          )}>
          {children}
        </ErrorBoundary>
      );
    }

    // Model
    function Text({children}) {
      return children;
    }

    function makeDelayedText() {
      let _resolve, _reject;
      let promise = new Promise((resolve, reject) => {
        _resolve = () => {
          promise = null;
          resolve();
        };
        _reject = e => {
          promise = null;
          reject(e);
        };
      });
      async function DelayedText({children}) {
        await promise;
        return <Text>{children}</Text>;
      }
      return [DelayedText, _resolve, _reject];
    }

    const [Friends, resolveFriends] = makeDelayedText();
    const [Name, resolveName] = makeDelayedText();
    const [Posts, resolvePosts] = makeDelayedText();
    const [Photos, resolvePhotos] = makeDelayedText();
    const [Games, , rejectGames] = makeDelayedText();

    // View
    function ProfileDetails({avatar}) {
      return (
        <div>
          <Name>:name:</Name>
          {avatar}
        </div>
      );
    }
    function ProfileSidebar({friends}) {
      return (
        <div>
          <Photos>:photos:</Photos>
          {friends}
        </div>
      );
    }
    function ProfilePosts({posts}) {
      return <div>{posts}</div>;
    }
    function ProfileGames({games}) {
      return <div>{games}</div>;
    }

    const MyErrorBoundaryClient = clientExports(MyErrorBoundary);

    function ProfileContent() {
      return (
        <>
          <ProfileDetails avatar={<Text>:avatar:</Text>} />
          <Suspense fallback={<p>(loading sidebar)</p>}>
            <ProfileSidebar friends={<Friends>:friends:</Friends>} />
          </Suspense>
          <Suspense fallback={<p>(loading posts)</p>}>
            <ProfilePosts posts={<Posts>:posts:</Posts>} />
          </Suspense>
          <MyErrorBoundaryClient>
            <Suspense fallback={<p>(loading games)</p>}>
              <ProfileGames games={<Games>:games:</Games>} />
            </Suspense>
          </MyErrorBoundaryClient>
        </>
      );
    }

    const model = {
      rootContent: <ProfileContent />,
    };

    function ProfilePage({response}) {
      return use(response).rootContent;
    }

    const {writable, readable} = getTestStream();
    const {pipe} = ReactServerDOMServer.renderToPipeableStream(
      model,
      webpackMap,
      {
        onError(x) {
          reportedErrors.push(x);
          return __DEV__ ? 'a dev digest' : `digest("${x.message}")`;
        },
      },
    );
    pipe(writable);
    const response = ReactServerDOMClient.createFromReadableStream(readable);

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <Suspense fallback={<p>(loading)</p>}>
          <ProfilePage response={response} />
        </Suspense>,
      );
    });
    expect(container.innerHTML).toBe('<p>(loading)</p>');

    // This isn't enough to show anything.
    await act(() => {
      resolveFriends();
    });
    expect(container.innerHTML).toBe('<p>(loading)</p>');

    // We can now show the details. Sidebar and posts are still loading.
    await act(() => {
      resolveName();
    });
    // Advance time enough to trigger a nested fallback.
    await act(() => {
      jest.advanceTimersByTime(500);
    });
    expect(container.innerHTML).toBe(
      '<div>:name::avatar:</div>' +
        '<p>(loading sidebar)</p>' +
        '<p>(loading posts)</p>' +
        '<p>(loading games)</p>',
    );

    expect(reportedErrors).toEqual([]);

    const theError = new Error('Game over');
    // Let's *fail* loading games.
    await act(async () => {
      await rejectGames(theError);
      await 'the inner async function';
    });
    const expectedGamesValue = __DEV__
      ? '<p>Game over + a dev digest</p>'
      : '<p>digest("Game over")</p>';
    expect(container.innerHTML).toBe(
      '<div>:name::avatar:</div>' +
        '<p>(loading sidebar)</p>' +
        '<p>(loading posts)</p>' +
        expectedGamesValue,
    );

    expect(reportedErrors).toEqual([theError]);
    reportedErrors = [];

    // We can now show the sidebar.
    await act(async () => {
      await resolvePhotos();
      await 'the inner async function';
    });
    expect(container.innerHTML).toBe(
      '<div>:name::avatar:</div>' +
        '<div>:photos::friends:</div>' +
        '<p>(loading posts)</p>' +
        expectedGamesValue,
    );

    // Show everything.
    await act(async () => {
      await resolvePosts();
      await 'the inner async function';
    });
    expect(container.innerHTML).toBe(
      '<div>:name::avatar:</div>' +
        '<div>:photos::friends:</div>' +
        '<div>:posts:</div>' +
        expectedGamesValue,
    );

    expect(reportedErrors).toEqual([]);
  });

  // @gate enableUseHook
  it('should preserve state of client components on refetch', async () => {
    // Client

    function Page({response}) {
      return use(response);
    }

    function Input() {
      return <input />;
    }

    const InputClient = clientExports(Input);

    // Server

    function App({color}) {
      // Verify both DOM and Client children.
      return (
        <div style={{color}}>
          <input />
          <InputClient />
        </div>
      );
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    const stream1 = getTestStream();
    const {pipe} = ReactServerDOMServer.renderToPipeableStream(
      <App color="red" />,
      webpackMap,
    );
    pipe(stream1.writable);
    const response1 = ReactServerDOMClient.createFromReadableStream(
      stream1.readable,
    );
    await act(() => {
      root.render(
        <Suspense fallback={<p>(loading)</p>}>
          <Page response={response1} />
        </Suspense>,
      );
    });
    expect(container.children.length).toBe(1);
    expect(container.children[0].tagName).toBe('DIV');
    expect(container.children[0].style.color).toBe('red');

    // Change the DOM state for both inputs.
    const inputA = container.children[0].children[0];
    expect(inputA.tagName).toBe('INPUT');
    inputA.value = 'hello';
    const inputB = container.children[0].children[1];
    expect(inputB.tagName).toBe('INPUT');
    inputB.value = 'goodbye';

    const stream2 = getTestStream();
    const {pipe: pipe2} = ReactServerDOMServer.renderToPipeableStream(
      <App color="blue" />,
      webpackMap,
    );
    pipe2(stream2.writable);
    const response2 = ReactServerDOMClient.createFromReadableStream(
      stream2.readable,
    );
    await act(() => {
      root.render(
        <Suspense fallback={<p>(loading)</p>}>
          <Page response={response2} />
        </Suspense>,
      );
    });
    expect(container.children.length).toBe(1);
    expect(container.children[0].tagName).toBe('DIV');
    expect(container.children[0].style.color).toBe('blue');

    // Verify we didn't destroy the DOM for either input.
    expect(inputA === container.children[0].children[0]).toBe(true);
    expect(inputA.tagName).toBe('INPUT');
    expect(inputA.value).toBe('hello');
    expect(inputB === container.children[0].children[1]).toBe(true);
    expect(inputB.tagName).toBe('INPUT');
    expect(inputB.value).toBe('goodbye');
  });

  // @gate enableUseHook
  it('should be able to complete after aborting and throw the reason client-side', async () => {
    const reportedErrors = [];

    const {writable, readable} = getTestStream();
    const {pipe, abort} = ReactServerDOMServer.renderToPipeableStream(
      <div>
        <InfiniteSuspend />
      </div>,
      webpackMap,
      {
        onError(x) {
          reportedErrors.push(x);
          const message = typeof x === 'string' ? x : x.message;
          return __DEV__ ? 'a dev digest' : `digest("${message}")`;
        },
      },
    );
    pipe(writable);
    const response = ReactServerDOMClient.createFromReadableStream(readable);

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    function App({res}) {
      return use(res);
    }

    await act(() => {
      root.render(
        <ErrorBoundary
          fallback={e => (
            <p>
              {__DEV__ ? e.message + ' + ' : null}
              {e.digest}
            </p>
          )}>
          <Suspense fallback={<p>(loading)</p>}>
            <App res={response} />
          </Suspense>
        </ErrorBoundary>,
      );
    });
    expect(container.innerHTML).toBe('<p>(loading)</p>');

    await act(() => {
      abort('for reasons');
    });
    if (__DEV__) {
      expect(container.innerHTML).toBe(
        '<p>Error: for reasons + a dev digest</p>',
      );
    } else {
      expect(container.innerHTML).toBe('<p>digest("for reasons")</p>');
    }

    expect(reportedErrors).toEqual(['for reasons']);
  });

  // @gate enableUseHook
  it('should be able to recover from a direct reference erroring client-side', async () => {
    const reportedErrors = [];

    const ClientComponent = clientExports(function ({prop}) {
      return 'This should never render';
    });

    const ClientReference = clientModuleError(new Error('module init error'));

    const {writable, readable} = getTestStream();
    const {pipe} = ReactServerDOMServer.renderToPipeableStream(
      <div>
        <ClientComponent prop={ClientReference} />
      </div>,
      webpackMap,
      {
        onError(x) {
          reportedErrors.push(x);
        },
      },
    );
    pipe(writable);
    const response = ReactServerDOMClient.createFromReadableStream(readable);

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    function App({res}) {
      return use(res);
    }

    await act(() => {
      root.render(
        <ErrorBoundary fallback={e => <p>{e.message}</p>}>
          <Suspense fallback={<p>(loading)</p>}>
            <App res={response} />
          </Suspense>
        </ErrorBoundary>,
      );
    });
    expect(container.innerHTML).toBe('<p>module init error</p>');

    expect(reportedErrors).toEqual([]);
  });

  // @gate enableUseHook
  it('should be able to recover from a direct reference erroring client-side async', async () => {
    const reportedErrors = [];

    const ClientComponent = clientExports(function ({prop}) {
      return 'This should never render';
    });

    let rejectPromise;
    const ClientReference = await clientExports(
      new Promise((resolve, reject) => {
        rejectPromise = reject;
      }),
    );

    const {writable, readable} = getTestStream();
    const {pipe} = ReactServerDOMServer.renderToPipeableStream(
      <div>
        <ClientComponent prop={ClientReference} />
      </div>,
      webpackMap,
      {
        onError(x) {
          reportedErrors.push(x);
        },
      },
    );
    pipe(writable);
    const response = ReactServerDOMClient.createFromReadableStream(readable);

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    function App({res}) {
      return use(res);
    }

    await act(() => {
      root.render(
        <ErrorBoundary fallback={e => <p>{e.message}</p>}>
          <Suspense fallback={<p>(loading)</p>}>
            <App res={response} />
          </Suspense>
        </ErrorBoundary>,
      );
    });

    expect(container.innerHTML).toBe('<p>(loading)</p>');

    await act(() => {
      rejectPromise(new Error('async module init error'));
    });

    expect(container.innerHTML).toBe('<p>async module init error</p>');

    expect(reportedErrors).toEqual([]);
  });

  // @gate enableUseHook
  it('should be able to recover from a direct reference erroring server-side', async () => {
    const reportedErrors = [];

    const ClientComponent = clientExports(function ({prop}) {
      return 'This should never render';
    });

    // We simulate a bug in the Webpack bundler which causes an error on the server.
    for (const id in webpackMap) {
      Object.defineProperty(webpackMap, id, {
        get: () => {
          throw new Error('bug in the bundler');
        },
      });
    }

    const {writable, readable} = getTestStream();
    const {pipe} = ReactServerDOMServer.renderToPipeableStream(
      <div>
        <ClientComponent />
      </div>,
      webpackMap,
      {
        onError(x) {
          reportedErrors.push(x.message);
          return __DEV__ ? 'a dev digest' : `digest("${x.message}")`;
        },
      },
    );
    pipe(writable);

    const response = ReactServerDOMClient.createFromReadableStream(readable);

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    function App({res}) {
      return use(res);
    }

    await act(() => {
      root.render(
        <ErrorBoundary
          fallback={e => (
            <p>
              {__DEV__ ? e.message + ' + ' : null}
              {e.digest}
            </p>
          )}>
          <Suspense fallback={<p>(loading)</p>}>
            <App res={response} />
          </Suspense>
        </ErrorBoundary>,
      );
    });
    if (__DEV__) {
      expect(container.innerHTML).toBe(
        '<p>bug in the bundler + a dev digest</p>',
      );
    } else {
      expect(container.innerHTML).toBe('<p>digest("bug in the bundler")</p>');
    }

    expect(reportedErrors).toEqual(['bug in the bundler']);
  });

  // @gate enableUseHook
  it('should pass a Promise through props and be able use() it on the client', async () => {
    async function getData() {
      return 'async hello';
    }

    function Component({data}) {
      const text = use(data);
      return <p>{text}</p>;
    }

    const ClientComponent = clientExports(Component);

    function ServerComponent() {
      const data = getData(); // no await here
      return <ClientComponent data={data} />;
    }

    function Print({response}) {
      return use(response);
    }

    function App({response}) {
      return (
        <Suspense fallback={<h1>Loading...</h1>}>
          <Print response={response} />
        </Suspense>
      );
    }

    const {writable, readable} = getTestStream();
    const {pipe} = ReactServerDOMServer.renderToPipeableStream(
      <ServerComponent />,
      webpackMap,
    );
    pipe(writable);
    const response = ReactServerDOMClient.createFromReadableStream(readable);

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<App response={response} />);
    });
    expect(container.innerHTML).toBe('<p>async hello</p>');
  });

  // @gate enableUseHook
  it('should throw on the client if a passed promise eventually rejects', async () => {
    const reportedErrors = [];
    const theError = new Error('Server throw');

    async function getData() {
      throw theError;
    }

    function Component({data}) {
      const text = use(data);
      return <p>{text}</p>;
    }

    const ClientComponent = clientExports(Component);

    function ServerComponent() {
      const data = getData(); // no await here
      return <ClientComponent data={data} />;
    }

    function Await({response}) {
      return use(response);
    }

    function App({response}) {
      return (
        <Suspense fallback={<h1>Loading...</h1>}>
          <ErrorBoundary
            fallback={e => (
              <p>
                {__DEV__ ? e.message + ' + ' : null}
                {e.digest}
              </p>
            )}>
            <Await response={response} />
          </ErrorBoundary>
        </Suspense>
      );
    }

    const {writable, readable} = getTestStream();
    const {pipe} = ReactServerDOMServer.renderToPipeableStream(
      <ServerComponent />,
      webpackMap,
      {
        onError(x) {
          reportedErrors.push(x);
          return __DEV__ ? 'a dev digest' : `digest("${x.message}")`;
        },
      },
    );
    pipe(writable);
    const response = ReactServerDOMClient.createFromReadableStream(readable);

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<App response={response} />);
    });
    expect(container.innerHTML).toBe(
      __DEV__
        ? '<p>Server throw + a dev digest</p>'
        : '<p>digest("Server throw")</p>',
    );
    expect(reportedErrors).toEqual([theError]);
  });

  // @gate enableUseHook
  it('should support ReactDOM.preload when rendering in Fiber', async () => {
    function Component() {
      return <p>hello world</p>;
    }

    const ClientComponent = clientExports(Component);

    async function ServerComponent() {
      ReactDOM.preload('before', {as: 'style'});
      await 1;
      ReactDOM.preload('after', {as: 'style'});
      return <ClientComponent />;
    }

    const {writable, readable} = getTestStream();
    const {pipe} = ReactServerDOMServer.renderToPipeableStream(
      <ServerComponent />,
      webpackMap,
    );
    pipe(writable);

    let response = null;
    function getResponse() {
      if (response === null) {
        response = ReactServerDOMClient.createFromReadableStream(readable);
      }
      return response;
    }

    function App() {
      return getResponse();
    }

    // We pause to allow the float call after the await point to process before the
    // HostDispatcher gets set for Fiber by createRoot. This is only needed in testing
    // because the module graphs are not different and the HostDispatcher is shared.
    // In a real environment the Fiber and Flight code would each have their own independent
    // dispatcher.
    // @TODO consider what happens when Server-Components-On-The-Client exist. we probably
    // want to use the Fiber HostDispatcher there too since it is more about the host than the runtime
    // but we need to make sure that actually makes sense
    await 1;

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<App />);
    });
    expect(document.head.innerHTML).toBe(
      '<link href="before" rel="preload" as="style">' +
        '<link href="after" rel="preload" as="style">',
    );
    expect(container.innerHTML).toBe('<p>hello world</p>');
  });

  // @gate enableUseHook
  it('should support ReactDOM.preload when rendering in Fizz', async () => {
    function Component() {
      return <p>hello world</p>;
    }

    const ClientComponent = clientExports(Component);

    async function ServerComponent() {
      ReactDOM.preload('before', {as: 'style'});
      await 1;
      ReactDOM.preload('after', {as: 'style'});
      return <ClientComponent />;
    }

    const {writable: flightWritable, readable: flightReadable} =
      getTestStream();
    const {writable: fizzWritable, readable: fizzReadable} = getTestStream();

    // In a real environment you would want to call the render during the Fizz render.
    // The reason we cannot do this in our test is because we don't actually have two separate
    // module graphs and we are contriving the sequencing to work in a way where
    // the right HostDispatcher is in scope during the Flight Server Float calls and the
    // Flight Client hint dispatches
    const {pipe} = ReactServerDOMServer.renderToPipeableStream(
      <ServerComponent />,
      webpackMap,
    );
    pipe(flightWritable);

    let response = null;
    function getResponse() {
      if (response === null) {
        response =
          ReactServerDOMClient.createFromReadableStream(flightReadable);
      }
      return response;
    }

    function App() {
      return (
        <html>
          <body>{getResponse()}</body>
        </html>
      );
    }

    await act(async () => {
      ReactDOMFizzServer.renderToPipeableStream(<App />).pipe(fizzWritable);
    });

    const decoder = new TextDecoder();
    const reader = fizzReadable.getReader();
    let content = '';
    while (true) {
      const {done, value} = await reader.read();
      if (done) {
        content += decoder.decode();
        break;
      }
      content += decoder.decode(value, {stream: true});
    }

    expect(content).toEqual(
      '<!DOCTYPE html><html><head><link rel="preload" as="style" href="before"/>' +
        '<link rel="preload" as="style" href="after"/></head><body><p>hello world</p></body></html>',
    );
  });

  it('supports Float hints from concurrent Flight -> Fizz renders', async () => {
    function Component() {
      return <p>hello world</p>;
    }

    const ClientComponent = clientExports(Component);

    async function ServerComponent1() {
      ReactDOM.preload('before1', {as: 'style'});
      await 1;
      ReactDOM.preload('after1', {as: 'style'});
      return <ClientComponent />;
    }

    async function ServerComponent2() {
      ReactDOM.preload('before2', {as: 'style'});
      await 1;
      ReactDOM.preload('after2', {as: 'style'});
      return <ClientComponent />;
    }

    const {writable: flightWritable1, readable: flightReadable1} =
      getTestStream();
    const {writable: flightWritable2, readable: flightReadable2} =
      getTestStream();

    ReactServerDOMServer.renderToPipeableStream(
      <ServerComponent1 />,
      webpackMap,
    ).pipe(flightWritable1);

    ReactServerDOMServer.renderToPipeableStream(
      <ServerComponent2 />,
      webpackMap,
    ).pipe(flightWritable2);

    const responses = new Map();
    function getResponse(stream) {
      let response = responses.get(stream);
      if (!response) {
        response = ReactServerDOMClient.createFromReadableStream(stream);
        responses.set(stream, response);
      }
      return response;
    }

    function App({stream}) {
      return (
        <html>
          <body>{getResponse(stream)}</body>
        </html>
      );
    }

    // pausing to let Flight runtime tick. This is a test only artifact of the fact that
    // we aren't operating separate module graphs for flight and fiber. In a real app
    // each would have their own dispatcher and there would be no cross dispatching.
    await 1;

    const {writable: fizzWritable1, readable: fizzReadable1} = getTestStream();
    const {writable: fizzWritable2, readable: fizzReadable2} = getTestStream();
    await act(async () => {
      ReactDOMFizzServer.renderToPipeableStream(
        <App stream={flightReadable1} />,
      ).pipe(fizzWritable1);
      ReactDOMFizzServer.renderToPipeableStream(
        <App stream={flightReadable2} />,
      ).pipe(fizzWritable2);
    });

    async function read(stream) {
      const decoder = new TextDecoder();
      const reader = stream.getReader();
      let buffer = '';
      while (true) {
        const {done, value} = await reader.read();
        if (done) {
          buffer += decoder.decode();
          break;
        }
        buffer += decoder.decode(value, {stream: true});
      }
      return buffer;
    }

    const [content1, content2] = await Promise.all([
      read(fizzReadable1),
      read(fizzReadable2),
    ]);

    expect(content1).toEqual(
      '<!DOCTYPE html><html><head><link rel="preload" as="style" href="before1"/>' +
        '<link rel="preload" as="style" href="after1"/></head><body><p>hello world</p></body></html>',
    );
    expect(content2).toEqual(
      '<!DOCTYPE html><html><head><link rel="preload" as="style" href="before2"/>' +
        '<link rel="preload" as="style" href="after2"/></head><body><p>hello world</p></body></html>',
    );
  });

  it('supports deduping hints by Float key', async () => {
    function Component() {
      return <p>hello world</p>;
    }

    const ClientComponent = clientExports(Component);

    async function ServerComponent() {
      ReactDOM.prefetchDNS('dns');
      ReactDOM.preconnect('preconnect');
      ReactDOM.preload('load', {as: 'style'});
      ReactDOM.preinit('init', {as: 'script'});
      // again but vary preconnect to demonstrate crossOrigin participates in the key
      ReactDOM.prefetchDNS('dns');
      ReactDOM.preconnect('preconnect', {crossOrigin: 'anonymous'});
      ReactDOM.preload('load', {as: 'style'});
      ReactDOM.preinit('init', {as: 'script'});
      await 1;
      // after an async point
      ReactDOM.prefetchDNS('dns');
      ReactDOM.preconnect('preconnect', {crossOrigin: 'use-credentials'});
      ReactDOM.preload('load', {as: 'style'});
      ReactDOM.preinit('init', {as: 'script'});
      return <ClientComponent />;
    }

    const {writable, readable} = getTestStream();

    ReactServerDOMServer.renderToPipeableStream(
      <ServerComponent />,
      webpackMap,
    ).pipe(writable);

    const hintRows = [];
    async function collectHints(stream) {
      const decoder = new TextDecoder();
      const reader = stream.getReader();
      let buffer = '';
      while (true) {
        const {done, value} = await reader.read();
        if (done) {
          buffer += decoder.decode();
          if (buffer.includes(':H')) {
            hintRows.push(buffer);
          }
          break;
        }
        buffer += decoder.decode(value, {stream: true});
        let line;
        while ((line = buffer.indexOf('\n')) > -1) {
          const row = buffer.slice(0, line);
          buffer = buffer.slice(line + 1);
          if (row.includes(':H')) {
            hintRows.push(row);
          }
        }
      }
    }

    await collectHints(readable);
    expect(hintRows.length).toEqual(6);
  });
});
