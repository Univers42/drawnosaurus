/** What one connection is: kept in its socket's attachment, so a woken object rebuilds it. */
export interface Connection {
  id: string;
  authenticated: boolean;
  /** Its subscriptions, as the client named them: `sub_id` and topic pattern. */
  subs: [subId: string, pattern: string][];
}

/** One frame for one connection. */
export interface Outbound {
  to: string;
  frame: string;
}

export class Relay {
  open(restored?: Connection): Connection {
    return restored ?? { id: "conn-0", authenticated: false, subs: [] };
  }

  connection(_id: string): Connection | undefined {
    return undefined;
  }

  receive(_id: string, _text: string): Outbound[] {
    return [];
  }

  close(_id: string): void {}
}

export function topicMatches(_pattern: string, _topic: string): boolean {
  return false;
}
