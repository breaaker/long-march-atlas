# 山河长征 · 1934—1936

以史料为依据的长征交互地图。包括四支主要长征部队、先遣行动、红四团片段、事件旁白、当代旧址与地理照片、常驻地名及部队跟随视角。

此仓库只包含可公开访问的静态网页运行资源。地图路线是现代概略锚点之间的示意连接，不是每日行军道路复原或全部师团的完整轨迹。日期异文、历史范围与来源见网页“考据与史料”。

网页无需Python后端。122段默认男声旁白已预先生成；浏览器需点击播放才会出声。

GitHub Pages使用main分支根目录发布。可在本目录运行`python3 -m http.server 8766 --bind 127.0.0.1`进行本地查看。

## 第三方资料与署名

- 各事件的历史资料URL保存在data.json，网页逐条关联。
- 11张当代照片各自保留作者、拍摄日期、来源和CC许可链接，见photos.json及网页“影像来源与授权”。显示可能按比例裁切和轻微低饱和处理；均非1930年代战地原照。
- 赤水河现代中心线：© OpenStreetMap contributors，ODbL 1.0，https://www.openstreetmap.org/copyright 。数据关系19390444；原始坐标及来源许可保留于assets/long-march-rivers.geojson。
- 其他主要河流来自Natural Earth（公共领域）：https://www.naturalearthdata.com/about/terms-of-use/ 。1:10m/1:50m指制图比例尺，并非米级定位精度。
- 现代省级轮廓：阿里云DataV GeoAtlas公开地理数据，https://datav.aliyun.com/portal/school/atlas/area_selector 。不将第三方数据统一声明为本站自有版权。
- 旁白为根据页面公开历史文字生成的AI合成语音（云希中文男声），不是历史录音或真人录音。

无需外部地图瓦片、字体或CDN运行依赖。首次访问仍需下载网页资源，不保证浏览器关闭后完整离线可用。
