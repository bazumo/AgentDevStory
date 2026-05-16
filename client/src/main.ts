import Phaser from "phaser";
import "./styles.css";
import type {
  AgentSession,
  ApiEvent,
  CreateProjectResponse,
  LinearTeam,
  WorldProject,
  WorldState
} from "../../shared/types";

const officeAssets = {
  desk: new URL("../../assets/web_office/desk.png", import.meta.url).href,
  chair: new URL("../../assets/web_office/chair.png", import.meta.url).href,
  laptop: new URL("../../assets/web_office/laptop.png", import.meta.url).href,
  server: new URL("../../assets/web_office/server_rack.png", import.meta.url).href,
  plant: new URL("../../assets/web_office/plant.png", import.meta.url).href,
  whiteboard: new URL("../../assets/web_office/whiteboard.png", import.meta.url).href
};

const tileWidth = 72;
const tileHeight = 36;

class OfficeScene extends Phaser.Scene {
  private world: WorldState | null = null;
  private selectedSessionId: string | null = null;
  private readonly objects: Phaser.GameObjects.GameObject[] = [];
  private isReady = false;

  constructor(private readonly selectSession: (session: AgentSession) => void) {
    super("office");
  }

  preload() {
    Object.entries(officeAssets).forEach(([key, url]) => this.load.image(key, url));
  }

  create() {
    this.isReady = true;
    this.cameras.main.setBackgroundColor("#171d22");
    this.scale.on("resize", () => this.renderWorld());
    this.renderWorld();
  }

  setWorld(world: WorldState) {
    this.world = world;
    this.renderWorld();
  }

  setSelectedSession(id: string | null) {
    this.selectedSessionId = id;
    this.renderWorld();
  }

  private renderWorld() {
    if (!this.isReady) return;

    for (const object of this.objects) object.destroy();
    this.objects.length = 0;

    const width = this.scale.width;
    const height = this.scale.height;

    const world = this.world;
    const sessionsByIssue = this.sessionsByIssue(world);
    this.drawOffice(width, height, world, sessionsByIssue);

    if (!world || world.projects.length === 0) this.drawEmptyState(width, height);
  }

  private sessionsByIssue(world: WorldState | null): Map<string, AgentSession[]> {
    const sessionsByIssue = new Map<string, AgentSession[]>();
    for (const session of world?.sessions ?? []) {
      const sessions = sessionsByIssue.get(session.issueId) ?? [];
      sessions.push(session);
      sessionsByIssue.set(session.issueId, sessions);
    }
    return sessionsByIssue;
  }

  private drawOffice(width: number, height: number, world: WorldState | null, sessionsByIssue: Map<string, AgentSession[]>) {
    this.addObject(this.add.rectangle(width / 2, height / 2, width, height, 0x78d2da));
    const graphics = this.add.graphics();
    this.drawBackdrop(graphics, width, height);
    this.drawParkGround(graphics, width, height);
    this.addObject(graphics);

    const projects = world?.projects ?? [];
    const projectSpacing = width < 700 ? 0 : Math.max(300, Math.min(410, (width - 160) / Math.max(1, projects.length)));
    const startX = width < 700 ? width / 2 : width / 2 - ((projects.length - 1) * projectSpacing) / 2;
    const startY = width < 700 ? 470 : 310;

    projects.forEach((project, index) => {
      const x = width < 700 ? startX : startX + index * projectSpacing;
      const y = width < 700 ? startY + index * 250 : startY + (index % 2) * 36;
      this.drawProjectPark(project, x, y, sessionsByIssue, index);
    });
  }

  private drawBackdrop(graphics: Phaser.GameObjects.Graphics, width: number, height: number) {
    graphics.fillStyle(0x68cbd2, 1);
    graphics.fillRect(0, 0, width, height);
    graphics.fillStyle(0xb8eef0, 0.28);
    for (let x = 28; x < width; x += 96) {
      graphics.fillRect(x, 48, 16, Math.max(220, height * 0.45));
    }
  }

  private drawParkGround(graphics: Phaser.GameObjects.Graphics, width: number, height: number) {
    const originX = width / 2;
    const originY = width < 700 ? 430 : 250;
    for (let x = -9; x <= 12; x += 1) {
      for (let y = -5; y <= 12; y += 1) {
        const point = this.isoPoint(originX, originY, x, y);
        const shade = (x + y) % 2 === 0 ? 0x4a8b6b : 0x438161;
        this.drawIsoDiamond(graphics, point.x, point.y, tileWidth, tileHeight, shade, 0x2d5f4a, 0.48);
      }
    }
  }

  private drawProjectPark(project: WorldProject, originX: number, originY: number, sessionsByIssue: Map<string, AgentSession[]>, projectIndex: number) {
    const graphics = this.add.graphics();
    const cols = 5;
    const rows = 5;

    for (let x = 0; x < cols; x += 1) {
      for (let y = 0; y < rows; y += 1) {
        const point = this.isoPoint(originX, originY, x, y);
        const fill = (x + y) % 2 === 0 ? 0x5aa978 : 0x4f9b6d;
        this.drawIsoDiamond(graphics, point.x, point.y, tileWidth, tileHeight, fill, 0x346c4f, 1);
      }
    }

    const front = this.isoPoint(originX, originY, cols, rows);
    const left = this.isoPoint(originX, originY, 0, rows);
    const right = this.isoPoint(originX, originY, cols, 0);
    graphics.lineStyle(5, 0x2d4f3c, 1);
    graphics.lineBetween(left.x, left.y, front.x, front.y);
    graphics.lineBetween(right.x, right.y, front.x, front.y);
    this.addObject(graphics);

    const signPoint = this.isoPoint(originX, originY, 2.2, -0.8);
    this.addObject(
      this.add
        .text(signPoint.x, signPoint.y - 18, project.name, titleStyle)
        .setOrigin(0.5)
        .setWordWrapWidth(230)
        .setAlign("center")
    );

    const issueSlots = [
      [1.1, 1.25],
      [2.85, 1.3],
      [1.7, 3.0],
      [3.35, 3.05]
    ];

    project.issues.forEach((issue, index) => {
      const [gridX, gridY] = issueSlots[index % issueSlots.length];
      const point = this.isoPoint(originX, originY, gridX, gridY);
      this.drawIssueBuilding(point.x, point.y, issue.identifier, issue.title, issue.runState, sessionsByIssue.get(issue.id) ?? [], projectIndex + index);
    });

    if (project.issues.length === 0) {
      const emptyPoint = this.isoPoint(originX, originY, 2.25, 2.4);
      this.addObject(this.add.text(emptyPoint.x, emptyPoint.y - 12, "No active issues", bodyStyle).setOrigin(0.5));
    }
  }

  private drawIssueBuilding(x: number, y: number, identifier: string, title: string, runState: string, sessions: AgentSession[], index: number) {
    const graphics = this.add.graphics();
    const running = runState === "running";
    const completed = runState === "completed" || runState === "terminal";
    const wallHeight = running ? 76 : completed ? 54 : 64;

    const back = new Phaser.Geom.Point(x, y - 64);
    const right = new Phaser.Geom.Point(x + 86, y - 20);
    const front = new Phaser.Geom.Point(x, y + 34);
    const left = new Phaser.Geom.Point(x - 86, y - 20);

    graphics.fillStyle(0x8a613d, 1);
    graphics.fillPoints([back, right, front, left], true);
    graphics.lineStyle(1, 0x5c3c24, 1);
    graphics.strokePoints([back, right, front, left], true);

    graphics.fillStyle(0xd8d0b9, 1);
    graphics.fillPoints([back, left, new Phaser.Geom.Point(left.x, left.y - wallHeight), new Phaser.Geom.Point(back.x, back.y - wallHeight)], true);
    graphics.fillStyle(0xbeb7a3, 1);
    graphics.fillPoints([back, right, new Phaser.Geom.Point(right.x, right.y - wallHeight), new Phaser.Geom.Point(back.x, back.y - wallHeight)], true);
    graphics.lineStyle(4, 0xf4eddb, 1);
    graphics.lineBetween(left.x, left.y - wallHeight, back.x, back.y - wallHeight);
    graphics.lineBetween(back.x, back.y - wallHeight, right.x, right.y - wallHeight);

    for (let i = 0; i < 3; i += 1) {
      graphics.fillStyle(running ? 0xffe9a0 : 0x98dbe4, completed ? 0.55 : 1);
      graphics.fillRect(x - 58 + i * 30, y - wallHeight - 58 + i * 2, 20, 28);
    }

    this.addObject(graphics);

    const label = this.add.text(x - 56, y - wallHeight - 78, identifier, badgeStyle).setOrigin(0.5);
    this.addObject(label);

    const statusText = sessions[0]?.status === "completed" ? "Done" : sessions[0]?.status === "failed" ? "Blocked" : sessions[0] ? "Working" : "Ready";
    if (sessions.length > 0) this.drawBubble(x + 26, y - wallHeight - 96, statusText);

    const desks = sessions.length > 0 ? sessions.slice(0, 4) : [];
    const deskOffsets = [
      [-38, -20],
      [30, -16],
      [-8, 16],
      [52, 18]
    ];
    desks.forEach((session, sessionIndex) => {
      const [dx, dy] = deskOffsets[sessionIndex];
      this.drawSessionDesk(x + dx, y + dy, session, index + sessionIndex);
    });

    if (desks.length === 0) this.drawEmptyDesk(x - 10, y + 4);

    const titleText = this.add
      .text(x, y + 48, title, tinyStyle)
      .setOrigin(0.5, 0)
      .setWordWrapWidth(150)
      .setAlign("center");
    this.addObject(titleText);
  }

  private drawSessionDesk(x: number, y: number, session: AgentSession, index: number) {
    const graphics = this.add.graphics();
    this.drawIsoBox(graphics, x, y, 54, 28, 18, 0x9a7048, 0x6e4b2e);
    this.addObject(graphics);
    this.drawMonitor(x - 6, y - 22, session.status === "running");
    this.drawPixelAgent(x + 24, y - 42, session.status, index);
    if (session.status === "running") this.drawFlames(x + 26, y - 48);

    const hitZone = this.add.zone(x, y - 30, 76, 90).setInteractive({ useHandCursor: true });
    hitZone.on("pointerdown", () => this.selectSession(session));
    this.addObject(hitZone);
  }

  private drawRoomShell(graphics: Phaser.GameObjects.Graphics, originX: number, originY: number, cols: number, rows: number) {
    const back = this.isoPoint(originX, originY, 0, 0);
    const right = this.isoPoint(originX, originY, cols, 0);
    const front = this.isoPoint(originX, originY, cols, rows);
    const left = this.isoPoint(originX, originY, 0, rows);
    const wallHeight = 150;

    graphics.fillStyle(0xb8b39e, 1);
    graphics.fillPoints([new Phaser.Geom.Point(back.x, back.y), new Phaser.Geom.Point(right.x, right.y), new Phaser.Geom.Point(right.x, right.y - wallHeight), new Phaser.Geom.Point(back.x, back.y - wallHeight)], true);
    graphics.fillStyle(0xd8d0b9, 1);
    graphics.fillPoints([new Phaser.Geom.Point(back.x, back.y), new Phaser.Geom.Point(left.x, left.y), new Phaser.Geom.Point(left.x, left.y - wallHeight), new Phaser.Geom.Point(back.x, back.y - wallHeight)], true);
    graphics.fillStyle(0xf3ead6, 1);
    graphics.fillCircle(back.x, back.y, 8);

    graphics.lineStyle(6, 0xefe8d4, 1);
    graphics.lineBetween(back.x, back.y - wallHeight, right.x, right.y - wallHeight);
    graphics.lineBetween(back.x, back.y - wallHeight, left.x, left.y - wallHeight);

    for (let i = 1; i < cols; i += 2) {
      const p = this.isoPoint(originX, originY, i, 0);
      this.drawWallWindow(graphics, p.x, p.y - 92, 1);
    }
    for (let i = 1; i < rows; i += 2) {
      const p = this.isoPoint(originX, originY, 0, i);
      this.drawWallWindow(graphics, p.x, p.y - 92, -1);
    }

    for (let x = 0; x < cols; x += 1) {
      for (let y = 0; y < rows; y += 1) {
        const point = this.isoPoint(originX, originY, x, y);
        const shade = (x + y) % 2 === 0 ? 0x9a6a40 : 0x875b36;
        this.drawIsoDiamond(graphics, point.x, point.y, tileWidth, tileHeight, shade, 0x684424, 1);
      }
    }

    graphics.lineStyle(2, 0xa8794c, 0.85);
    for (let x = 0; x <= cols; x += 1) {
      const a = this.isoPoint(originX, originY, x, 0);
      const b = this.isoPoint(originX, originY, x, rows);
      graphics.lineBetween(a.x, a.y, b.x, b.y);
    }
    for (let y = 0; y <= rows; y += 1) {
      const a = this.isoPoint(originX, originY, 0, y);
      const b = this.isoPoint(originX, originY, cols, y);
      graphics.lineBetween(a.x, a.y, b.x, b.y);
    }

    graphics.lineStyle(7, 0x5a3924, 1);
    graphics.lineBetween(left.x, left.y, front.x, front.y);
    graphics.lineBetween(right.x, right.y, front.x, front.y);
    graphics.lineStyle(6, 0xf5eedc, 1);
    graphics.lineBetween(back.x, back.y, right.x, right.y);
    graphics.lineBetween(back.x, back.y, left.x, left.y);
  }

  private drawEmptyState(width: number, height: number) {
    const text = this.add
      .text(width / 2, Math.max(500, height * 0.68), "Create a Linear project to open the office.", {
        color: "#143347",
        fontSize: "20px",
        fontFamily: "sans-serif",
        backgroundColor: "#f5f0db",
        padding: { x: 12, y: 8 }
      })
      .setOrigin(0.5);
    this.addObject(text);
  }

  private drawWallWindow(graphics: Phaser.GameObjects.Graphics, x: number, y: number, direction: 1 | -1) {
    const slant = direction * 20;
    graphics.fillStyle(0xeef8f1, 1);
    graphics.fillPoints([new Phaser.Geom.Point(x - 22, y), new Phaser.Geom.Point(x + 34, y + slant), new Phaser.Geom.Point(x + 34, y + slant + 58), new Phaser.Geom.Point(x - 22, y + 58)], true);
    graphics.fillStyle(0x91dfea, 1);
    graphics.fillPoints([new Phaser.Geom.Point(x - 15, y + 8), new Phaser.Geom.Point(x + 27, y + slant + 13), new Phaser.Geom.Point(x + 27, y + slant + 50), new Phaser.Geom.Point(x - 15, y + 47)], true);
  }

  private drawWallProps(originX: number, originY: number, cols: number, rows: number) {
    const whiteboard = this.isoPoint(originX, originY, Math.min(4, cols - 2), 0.2);
    this.addObject(this.add.image(whiteboard.x, whiteboard.y - 100, "whiteboard").setScale(1.2));

    const plant = this.isoPoint(originX, originY, 0.6, Math.min(rows - 1.2, 5.8));
    this.addObject(this.add.image(plant.x - 20, plant.y - 8, "plant").setScale(0.9));

    const rack = this.isoPoint(originX, originY, Math.min(cols - 1.2, 10.5), 0.8);
    this.addObject(this.add.image(rack.x + 22, rack.y - 32, "server").setScale(0.95));
  }

  private drawDeskPod(
    x: number,
    y: number,
    identifier: string,
    title: string,
    projectName: string,
    runState: string,
    session: AgentSession | undefined,
    index: number
  ) {
    const lit = runState === "running";
    const completed = runState === "completed" || runState === "terminal";
    const stroke = session?.id === this.selectedSessionId ? 0xe6c76f : 0x89a7b1;
    const graphics = this.add.graphics();
    this.drawIsoBox(graphics, x, y, 92, 42, 34, 0x9a7048, 0x6e4b2e);
    this.drawIsoBox(graphics, x - 38, y + 38, 34, 28, 28, completed ? 0x2f343a : 0x343a40, 0x22272c);
    this.drawIsoBox(graphics, x + 32, y + 32, 28, 20, 18, 0x31425a, 0x202939);

    graphics.lineStyle(2, stroke, session?.id === this.selectedSessionId ? 1 : 0);
    graphics.strokeRect(x - 58, y - 72, 116, 128);
    this.addObject(graphics);

    this.addObject(this.add.image(x + 2, y - 30, "laptop").setScale(0.42));
    this.drawMonitor(x - 18, y - 35, lit);
    this.drawPixelAgent(x + 44, y - 52, session?.status ?? runState, index);

    const label = this.add.text(x - 42, y - 96, identifier, badgeStyle).setOrigin(0.5);
    this.addObject(label);

    const titleText = this.add
      .text(x, y + 58, title, bodyStyle)
      .setOrigin(0.5, 0)
      .setWordWrapWidth(155)
      .setAlign("center");
    this.addObject(titleText);

    if (lit) this.drawFlames(x + 34, y - 58);
    if (session) this.drawBubble(x + 8, y - 120, session.status === "completed" ? "Done" : session.status === "failed" ? "Fix me" : "Working");

    const projectText = this.add
      .text(x, y + 90, projectName, tinyStyle)
      .setOrigin(0.5, 0)
      .setWordWrapWidth(150)
      .setAlign("center");
    this.addObject(projectText);

    if (session) {
      const hitZone = this.add.zone(x, y - 20, 150, 150).setInteractive({ useHandCursor: true });
      hitZone.on("pointerdown", () => this.selectSession(session));
      this.addObject(hitZone);
    }
  }

  private drawEmptyDesk(x: number, y: number) {
    const graphics = this.add.graphics();
    this.drawIsoBox(graphics, x, y, 92, 42, 26, 0x8f6843, 0x67482d);
    this.addObject(graphics);
    this.addObject(this.add.image(x + 2, y - 25, "laptop").setScale(0.38).setAlpha(0.65));
  }

  private drawIsoBox(graphics: Phaser.GameObjects.Graphics, x: number, y: number, width: number, depth: number, height: number, topColor: number, sideColor: number) {
    const top = [
      new Phaser.Geom.Point(x, y - height - depth / 2),
      new Phaser.Geom.Point(x + width / 2, y - height),
      new Phaser.Geom.Point(x, y - height + depth / 2),
      new Phaser.Geom.Point(x - width / 2, y - height)
    ];
    const left = [top[3], top[2], new Phaser.Geom.Point(x, y + depth / 2), new Phaser.Geom.Point(x - width / 2, y)];
    const right = [top[1], top[2], new Phaser.Geom.Point(x, y + depth / 2), new Phaser.Geom.Point(x + width / 2, y)];

    graphics.fillStyle(sideColor, 1);
    graphics.fillPoints(left, true);
    graphics.fillStyle(Phaser.Display.Color.ValueToColor(sideColor).brighten(12).color, 1);
    graphics.fillPoints(right, true);
    graphics.fillStyle(topColor, 1);
    graphics.fillPoints(top, true);
    graphics.lineStyle(1, 0x3c2b20, 0.7);
    graphics.strokePoints(top, true);
  }

  private drawMonitor(x: number, y: number, lit: boolean) {
    const graphics = this.add.graphics();
    graphics.fillStyle(0x26313a, 1);
    graphics.fillRect(x - 11, y - 18, 22, 16);
    graphics.fillStyle(lit ? 0x98f0ff : 0x4f6870, 1);
    graphics.fillRect(x - 8, y - 15, 16, 10);
    graphics.fillStyle(0x1e262b, 1);
    graphics.fillRect(x - 2, y - 2, 4, 8);
    graphics.fillRect(x - 10, y + 6, 20, 4);
    this.addObject(graphics);
  }

  private drawPixelAgent(x: number, y: number, status: string, index: number) {
    const graphics = this.add.graphics();
    const shirt = [0x375ca8, 0x8b4aa0, 0x3d8f63, 0xb75b38, 0x5a6475][index % 5];
    graphics.fillStyle(0x2b2320, 1);
    graphics.fillRect(x - 9, y - 30, 18, 10);
    graphics.fillStyle(0xf0bf85, 1);
    graphics.fillRect(x - 8, y - 24, 16, 16);
    graphics.fillStyle(0x1c1c1c, 1);
    graphics.fillRect(x - 4, y - 18, 3, 3);
    graphics.fillRect(x + 4, y - 18, 3, 3);
    graphics.fillStyle(shirt, status === "completed" ? 0.65 : 1);
    graphics.fillRect(x - 11, y - 8, 22, 26);
    graphics.fillStyle(0x202020, 1);
    graphics.fillRect(x - 9, y + 18, 7, 16);
    graphics.fillRect(x + 2, y + 18, 7, 16);
    if (status === "running") {
      graphics.fillStyle(0xfff4a0, 1);
      graphics.fillRect(x + 13, y - 31, 5, 5);
      graphics.fillRect(x + 20, y - 38, 5, 5);
    }
    this.addObject(graphics);
  }

  private drawBubble(x: number, y: number, text: string) {
    const bubble = this.add.text(x, y, text, bubbleStyle).setOrigin(0.5);
    this.addObject(bubble);
  }

  private drawFlames(x: number, y: number) {
    const graphics = this.add.graphics();
    graphics.fillStyle(0xff341f, 0.8);
    graphics.fillTriangle(x - 22, y + 26, x, y - 34, x + 22, y + 26);
    graphics.fillStyle(0xffb121, 0.95);
    graphics.fillTriangle(x - 12, y + 22, x + 2, y - 18, x + 14, y + 22);
    this.addObject(graphics);
  }

  private isoPoint(originX: number, originY: number, gridX: number, gridY: number): { x: number; y: number } {
    return {
      x: originX + ((gridX - gridY) * tileWidth) / 2,
      y: originY + ((gridX + gridY) * tileHeight) / 2
    };
  }

  private drawIsoDiamond(
    graphics: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    width: number,
    height: number,
    fill: number,
    stroke: number,
    alpha = 1
  ) {
    const points = [
      new Phaser.Geom.Point(x, y - height / 2),
      new Phaser.Geom.Point(x + width / 2, y),
      new Phaser.Geom.Point(x, y + height / 2),
      new Phaser.Geom.Point(x - width / 2, y)
    ];
    graphics.fillStyle(fill, alpha);
    graphics.fillTriangle(points[0].x, points[0].y, points[1].x, points[1].y, points[2].x, points[2].y);
    graphics.fillTriangle(points[0].x, points[0].y, points[2].x, points[2].y, points[3].x, points[3].y);
    graphics.lineStyle(1, stroke, alpha);
    graphics.lineBetween(points[0].x, points[0].y, points[1].x, points[1].y);
    graphics.lineBetween(points[1].x, points[1].y, points[2].x, points[2].y);
    graphics.lineBetween(points[2].x, points[2].y, points[3].x, points[3].y);
    graphics.lineBetween(points[3].x, points[3].y, points[0].x, points[0].y);
  }

  private addObject<T extends Phaser.GameObjects.GameObject>(object: T): T {
    this.objects.push(object);
    return object;
  }
}

const titleStyle: Phaser.Types.GameObjects.Text.TextStyle = {
  color: "#fff7da",
  fontSize: "17px",
  fontFamily: "sans-serif",
  fontStyle: "700"
};

const bodyStyle: Phaser.Types.GameObjects.Text.TextStyle = {
  color: "#dce9ed",
  fontSize: "12px",
  fontFamily: "sans-serif"
};

const tinyStyle: Phaser.Types.GameObjects.Text.TextStyle = {
  color: "#173346",
  fontSize: "10px",
  fontFamily: "sans-serif"
};

const badgeStyle: Phaser.Types.GameObjects.Text.TextStyle = {
  color: "#1b211b",
  backgroundColor: "#e6c76f",
  fontSize: "11px",
  fontFamily: "sans-serif",
  fontStyle: "700",
  padding: { x: 5, y: 3 }
};

const bubbleStyle: Phaser.Types.GameObjects.Text.TextStyle = {
  color: "#1746af",
  backgroundColor: "#f8fbff",
  fontSize: "14px",
  fontFamily: "sans-serif",
  padding: { x: 8, y: 4 }
};

class App {
  private world: WorldState | null = null;
  private teams: LinearTeam[] = [];
  private selectedSession: AgentSession | null = null;
  private scene!: OfficeScene;
  private readonly root = document.querySelector<HTMLDivElement>("#app-ui")!;

  start() {
    this.renderUi();
    this.scene = new OfficeScene((session) => this.openSession(session));

    new Phaser.Game({
      type: Phaser.AUTO,
      parent: "game-root",
      backgroundColor: "#171d22",
      scale: {
        mode: Phaser.Scale.RESIZE,
        width: window.innerWidth,
        height: window.innerHeight
      },
      render: {
        pixelArt: true,
        antialias: false
      },
      scene: this.scene
    });

    void this.loadTeams();
    void this.loadWorld();
    this.connectEvents();
  }

  private async loadTeams() {
    const response = await fetch("/api/linear/teams");
    const data = (await response.json()) as { teams: LinearTeam[] };
    this.teams = data.teams;
    this.renderUi();
  }

  private async loadWorld() {
    const response = await fetch("/api/world");
    this.world = (await response.json()) as WorldState;
    this.scene?.setWorld(this.world);
    this.renderUi();
  }

  private connectEvents() {
    const source = new EventSource("/api/events");
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as ApiEvent;
      if (event.type === "world") {
        this.world = event.world;
        this.scene?.setWorld(event.world);
        if (this.selectedSession) {
          this.selectedSession = event.world.sessions.find((session) => session.id === this.selectedSession?.id) ?? null;
        }
        this.renderUi();
      }
      if (event.type === "session") {
        if (this.selectedSession?.id === event.session.id) this.selectedSession = event.session;
        this.renderUi();
      }
    };
  }

  private renderUi() {
    const world = this.world;
    const teamOptions = this.teams
      .map((team) => `<option value="${escapeHtml(team.id)}">${escapeHtml(team.name)}${team.key ? ` (${team.key})` : ""}</option>`)
      .join("");

    this.root.innerHTML = `
      <div class="topbar">
        <form class="panel project-form" id="project-form">
          <div class="form-title">
            <h1>AgentDevStory</h1>
            <span class="status-pill ${world?.mode === "live" ? "live" : ""}">${world?.mode ?? "loading"}</span>
          </div>
          <div class="field">
            <label for="team-id">Linear team</label>
            <select id="team-id" name="teamId" required>
              ${teamOptions || `<option value="">Loading teams</option>`}
            </select>
          </div>
          <div class="field">
            <label for="project-name">Project name</label>
            <input id="project-name" name="name" required maxlength="80" placeholder="Website polish sprint" />
          </div>
          <div class="field">
            <label for="project-description">Description</label>
            <textarea id="project-description" name="description" placeholder="What should this project accomplish?"></textarea>
          </div>
          <div class="actions">
            <button type="submit" ${this.teams.length === 0 ? "disabled" : ""}>Create Project</button>
            <span class="message" id="form-message"></span>
          </div>
        </form>
        <div class="panel status-panel">
          <div class="metric"><strong>${world?.projects.length ?? 0}</strong><span>projects</span></div>
          <div class="metric"><strong>${world?.projects.reduce((sum, project) => sum + project.issues.length, 0) ?? 0}</strong><span>active issues</span></div>
          <div class="metric"><strong>${world?.backend.runningAgents ?? 0}/${world?.backend.maxConcurrentAgents ?? 0}</strong><span>agents</span></div>
        </div>
      </div>
      <section class="panel drawer ${this.selectedSession ? "open" : ""}">
        ${this.renderDrawer()}
      </section>
    `;

    this.root.querySelector("#project-form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.submitProject(event.currentTarget as HTMLFormElement);
    });
    this.root.querySelector("#close-drawer")?.addEventListener("click", () => this.closeSession());
  }

  private renderDrawer(): string {
    const session = this.selectedSession;
    if (!session) return "";

    const events = session.transcript
      .slice()
      .reverse()
      .map(
        (event) => `
          <div class="event">
            <div class="event-meta">${escapeHtml(event.kind)} · ${new Date(event.at).toLocaleTimeString()}</div>
            <div class="event-message">${escapeHtml(event.message)}</div>
          </div>
        `
      )
      .join("");

    return `
      <div class="drawer-header">
        <div>
          <h2>${escapeHtml(session.issueIdentifier)} · ${escapeHtml(session.profession)}</h2>
          <div class="drawer-subtitle">${escapeHtml(session.status)} · attempt ${session.attempt}</div>
        </div>
        <button type="button" id="close-drawer">Close</button>
      </div>
      <div class="drawer-body">
        <div class="drawer-subtitle">${escapeHtml(session.workspacePath ?? "No workspace configured")}</div>
        ${events || `<div class="event-message">No events yet.</div>`}
      </div>
    `;
  }

  private async submitProject(form: HTMLFormElement) {
    const message = form.querySelector<HTMLSpanElement>("#form-message")!;
    const submit = form.querySelector<HTMLButtonElement>("button[type='submit']")!;
    const body = Object.fromEntries(new FormData(form).entries());

    submit.disabled = true;
    message.textContent = "Creating...";

    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const error = (await response.json()) as { error?: string };
        throw new Error(error.error ?? "Project creation failed");
      }

      const result = (await response.json()) as CreateProjectResponse;
      form.reset();
      message.textContent = `Created ${result.name}`;
    } catch (error) {
      message.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      submit.disabled = false;
    }
  }

  private openSession(session: AgentSession) {
    this.selectedSession = session;
    this.scene.setSelectedSession(session.id);
    this.renderUi();
  }

  private closeSession() {
    this.selectedSession = null;
    this.scene.setSelectedSession(null);
    this.renderUi();
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

new App().start();
