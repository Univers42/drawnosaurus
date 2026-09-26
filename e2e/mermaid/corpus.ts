/**
 * Definitions as people write them: each diagram type's own example from Mermaid's
 * documentation (mermaid.js.org/syntax), a few of them grown by the constructs real
 * diagrams lean on — subgraphs, notes, namespaces, composite states.
 */
export const CORPUS: { type: string; name: string; source: string }[] = [
  {
    type: "flowchart",
    name: "ci pipeline",
    source: `flowchart LR
  dev([Developer]) -->|push| ci{CI green?}
  subgraph build [Build]
    direction TB
    lint[Lint] --> test[Unit tests] --> wasm[[WASM]]
  end
  ci -->|yes| build
  ci -.->|no| dev
  wasm --> deploy[(Registry)]
  deploy ==> prod>Production]
  classDef hot fill:#ffc9c9,stroke:#e03131
  class prod hot`,
  },
  {
    type: "flowchart",
    name: "decision tree",
    source: `graph TD
  A[Christmas] -->|Get money| B(Go shopping)
  B --> C{Let me think}
  C -->|One| D[Laptop]
  C -->|Two| E[iPhone]
  C -->|Three| F[fa:fa-car Car]`,
  },
  {
    type: "sequence",
    name: "login",
    source: `sequenceDiagram
  autonumber
  actor U as User
  participant W as Web app
  participant A as API
  participant D as Database
  U->>W: Open board
  W->>+A: GET /v1/boards/:slug
  A->>D: find by slug
  alt found
    D-->>A: board
    A-->>W: 200 board
  else missing
    A-->>-W: 404
  end
  Note over W,A: every edit is a PATCH
  loop autosave
    W-)A: PATCH elements
  end`,
  },
  {
    type: "class",
    name: "animals",
    source: `classDiagram
  note "From Duck till Zebra"
  Animal <|-- Duck
  note for Duck "can fly\\ncan swim"
  Animal <|-- Fish
  Animal <|-- Zebra
  Animal : +int age
  Animal : +String gender
  Animal: +isMammal()
  Animal: +mate()
  class Duck{
    +String beakColor
    +swim()
    +quack()
  }
  class Fish{
    -int sizeInFeet
    -canEat()
  }
  class Zebra{
    +bool is_wild
    +run()
  }`,
  },
  {
    type: "class",
    name: "namespaced",
    source: `classDiagram
  namespace Shapes {
    class Triangle
    class Rectangle {
      double width
      double height
    }
  }
  class Shape {
    <<interface>>
    +area() double
  }
  Shape <|.. Triangle
  Shape <|.. Rectangle : implements
  Rectangle "1" *-- "4" Corner`,
  },
  {
    type: "state",
    name: "composite",
    source: `stateDiagram-v2
  [*] --> Still
  Still --> [*]
  Still --> Moving
  Moving --> Still
  Moving --> Crash
  Crash --> [*]
  state Moving {
    [*] --> Slow
    Slow --> Fast : accelerate
    Fast --> Slow : brake
  }
  note right of Crash : call for help`,
  },
  {
    type: "er",
    name: "orders",
    source: `erDiagram
  CUSTOMER ||--o{ ORDER : places
  ORDER ||--|{ LINE-ITEM : contains
  CUSTOMER }|..|{ DELIVERY-ADDRESS : uses
  CUSTOMER {
    string name
    string custNumber PK
    string sector
  }
  ORDER {
    int orderNumber PK
    string deliveryAddress FK
  }`,
  },
  {
    type: "gantt",
    name: "release",
    source: `gantt
  title Release plan
  dateFormat YYYY-MM-DD
  section Engine
  insertJson        :done, e1, 2026-09-01, 3d
  label fitting     :active, e2, after e1, 2d
  section App
  converter         :a1, 2026-09-03, 4d
  fuzz              :crit, a2, after a1, 3d
  release           :milestone, after a2, 0d`,
  },
  {
    type: "pie",
    name: "pets",
    source: `pie showData title Key elements in Product X
  "Calcium" : 42.96
  "Potassium" : 50.05
  "Magnesium" : 10.01
  "Iron" : 5`,
  },
  {
    type: "mindmap",
    name: "origins",
    source: `mindmap
  root((mindmap))
    Origins
      Long history
      ::icon(fa fa-book)
      Popularisation
        British popular psychology author Tony Buzan
    Research
      On effectiveness<br/>and features
      On Automatic creation
        Uses
            Creative techniques
            Strategic planning
    Tools
      Pen and paper
      Mermaid`,
  },
  {
    type: "timeline",
    name: "social media",
    source: `timeline
  title History of Social Media Platform
  2002 : LinkedIn
  2004 : Facebook : Google
  2005 : YouTube
  2006 : Twitter`,
  },
  {
    type: "gitGraph",
    name: "feature branch",
    source: `gitGraph
  commit
  commit
  branch develop
  checkout develop
  commit
  commit
  checkout main
  merge develop
  commit id: "release" tag: "v1.0"
  branch hotfix
  commit type: HIGHLIGHT
  checkout main
  merge hotfix`,
  },
  {
    type: "journey",
    name: "working day",
    source: `journey
  title My working day
  section Go to work
    Make tea: 5: Me
    Go upstairs: 3: Me
    Do work: 1: Me, Cat
  section Go home
    Go downstairs: 5: Me
    Sit down: 5: Me`,
  },
  {
    type: "quadrant",
    name: "campaigns",
    source: `quadrantChart
  title Reach and engagement of campaigns
  x-axis Low Reach --> High Reach
  y-axis Low Engagement --> High Engagement
  quadrant-1 We should expand
  quadrant-2 Need to promote
  quadrant-3 Re-evaluate
  quadrant-4 May be improved
  Campaign A: [0.3, 0.6]
  Campaign B: [0.45, 0.23]
  Campaign C: [0.57, 0.69]
  Campaign D: [0.78, 0.34]`,
  },
  {
    type: "sankey",
    name: "energy",
    source: `sankey-beta

Agricultural 'waste',Bio-conversion,124.729
Bio-conversion,Liquid,0.597
Bio-conversion,Losses,26.862
Bio-conversion,Solid,280.322
Bio-conversion,Gas,81.144
Biofuel imports,Liquid,35`,
  },
  {
    type: "xychart",
    name: "revenue",
    source: `xychart-beta
  title "Sales Revenue"
  x-axis [jan, feb, mar, apr, may, jun, jul, aug, sep, oct, nov, dec]
  y-axis "Revenue (in $)" 4000 --> 11000
  bar [5000, 6000, 7500, 8200, 9500, 10500, 11000, 10200, 9200, 8500, 7000, 6000]
  line [5000, 6000, 7500, 8200, 9500, 10500, 11000, 10200, 9200, 8500, 7000, 6000]`,
  },
  {
    type: "block",
    name: "columns",
    source: `block-beta
  columns 3
  a["Frontend"] b["API"] c["Database"]
  space:3
  d(("Cache")) e{"Queue"} f
  a --> b
  b --> c`,
  },
  {
    type: "architecture",
    name: "api",
    source: `architecture-beta
  group api(cloud)[API]
  service db(database)[Database] in api
  service disk1(disk)[Storage] in api
  service server(server)[Server] in api
  db:L -- R:server
  disk1:T -- B:server`,
  },
  {
    type: "c4",
    name: "banking",
    source: `C4Context
  title System Context diagram for Internet Banking System
  Person(customerA, "Banking Customer A", "A customer of the bank")
  Enterprise_Boundary(b1, "BankBoundary") {
    System(SystemAA, "Internet Banking System", "Allows customers to view their accounts")
    SystemDb_Ext(SystemE, "Mainframe Banking System", "Stores all of the core banking information")
  }
  Rel(customerA, SystemAA, "Uses")
  Rel(SystemAA, SystemE, "Uses")`,
  },
  {
    type: "requirement",
    name: "test entity",
    source: `requirementDiagram
  requirement test_req {
    id: 1
    text: the test text.
    risk: high
    verifymethod: test
  }
  element test_entity {
    type: simulation
  }
  test_entity - satisfies -> test_req`,
  },
  {
    type: "kanban",
    name: "board",
    source: `kanban
  todo[Todo]
    t1[Write the fuzzer]
    t2[Pin Mermaid]@{ priority: 'High' }
  doing[In progress]
    t3[Label fitting]
  done[Done]
    t4[insertJson]`,
  },
  {
    type: "packet",
    name: "tcp",
    source: `packet-beta
  0-15: "Source Port"
  16-31: "Destination Port"
  32-63: "Sequence Number"
  64-95: "Acknowledgment Number"
  96-99: "Data Offset"
  100-105: "Reserved"
  106-111: "Flags"
  112-127: "Window"`,
  },
];
