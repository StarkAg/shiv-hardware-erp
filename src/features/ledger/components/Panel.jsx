import React from 'react';

/**
 * Keeps one screen's failure to itself.
 *
 * Convex answers a call to a function the deployment does not have by throwing
 * from `useQuery`, during render — so a screen whose query has not been pushed
 * yet takes the whole app down with it, ledgers and all, and the shop is left
 * with a white page and nothing to read. A tab is a small enough thing to lose
 * on its own.
 */
export default class Panel extends React.Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const said = error.message ?? String(error);
    // A dev deployment names what went wrong; production answers every failure
    // with a bare "Server Error" and nothing else, so the message cannot be
    // read to tell a missing function from a broken one. What both do carry is
    // the function that was called — Convex prefixes it as `Q(module:name)` —
    // and naming it is the whole of what anyone needs to go and push it.
    const fn = /\b[QMA]\((.+?)\)/.exec(said)?.[1];

    return (
      <div className="empty">
        This screen could not be drawn.
        {fn ? (
          <div className="hint">
            The deployment could not run <code>{fn}</code>. If that function is new here,
            it has not been pushed yet — <code>npx convex dev</code> for the dev deployment,
            <code>npx convex deploy</code> for the one behind the website.
          </div>
        ) : (
          <div className="hint">{said}</div>
        )}
      </div>
    );
  }
}
