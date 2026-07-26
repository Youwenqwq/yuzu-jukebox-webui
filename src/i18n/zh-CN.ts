/**
 * zh-CN 文案目录。key 结构按界面域划分；插值用 {{var}}。
 * 语气纪律：控件说会发生什么（“点这首歌”而非“提交”）；
 * 错误不道歉、只说发生了什么和怎么办；空态是邀请。
 */
export const zhCN = {
  app: {
    title: 'Yuzu Jukebox',
  },
  common: {
    loading: '加载中…',
    retry: '重试',
    cancel: '取消',
    confirm: '确认',
    back: '返回',
  },
  conn: {
    connecting: '连接中…',
    reconnecting: '连接断了，正在重连…',
    offline: '连接断开',
  },
  theme: {
    accent: '主题色',
    custom: '自定义颜色',
    switchScheme: '切换深色 / 浅色',
  },
  login: {
    title: '进入大厅',
    namePlaceholder: '你的名字',
    passwordPlaceholder: '管理员口令（可选）',
    submit: '进入',
    failed: '登录失败：{{message}}',
  },
  lobby: {
    eyebrow: 'Lobby · 大厅',
    title: '今晚去哪一间？',
    playing: '播放中',
    idle: '空闲',
    listenerCount: '{{count}} 人在听',
    emptyQueue: '队列空了',
    firstSong: '来点第一首歌 →',
    createRoom: '+ 创建房间',
    noRooms: '还没有房间，等管理员开一间',
  },
  room: {
    backToLobby: '← 大厅',
    join: '进房',
    needPassword: '这间房需要密码',
    passwordPlaceholder: '房间密码',
    addSong: '+ 点歌',
    nowPlaying: 'Now Playing · 正在播放',
    requestedBy: '{{name}} 点 · {{time}} 入场',
    volume: '音量',
    queueTitle: 'QUEUE · 队列',
    queueCount: '{{count}} 首待播',
    queueEmpty: '队列空了，点第一首歌',
    radioNote: '队列少于 3 首时，电台将自动续播',
    radioOn: '电台 · {{source}}',
    listenerCount: '{{count}} 人在听',
    mine: '{{name}}（你）',
    removeOwn: '撤下这首',
    removeAdmin: '移除',
    pause: '暂停',
    resume: '继续播放',
    skip: '切歌',
    addedToast: '已加入队列 · {{title}}',
  },
  search: {
    placeholder: '搜歌名、歌手…',
    submit: '搜索',
    empty: '没找到，换个词试试',
    add: '点这首歌',
  },
  error: {
    unauthorized: '登录已失效，请重新进入',
    forbidden: '你没有权限执行这个操作',
    bad_request: '请求被拒绝：{{message}}',
    queue_full: '队列满了，等几首播完再点',
    quota_exceeded: '你点的歌已达上限，播完后再来',
    not_found: '目标不存在',
    provider_error: '曲目来源出了点问题：{{message}}',
    internal: '服务端内部错误',
    rate_limited: '操作太频繁了，稍等一下',
    unknown: '未知错误：{{message}}',
  },
} as const;

export type Messages = typeof zhCN;
