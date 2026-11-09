# Windows 代码签名：香港公司使用 SSL.com OV 与 eSigner

本文面向负责 ClawX 和 ClawX Biz 发布的公司管理员与开发人员，说明从申请证书到两个仓库自动签名的完整操作。方案是：以实际发行两款软件的香港公司申请一张 **OV Code Signing** 证书，将私钥保管在 **SSL.com eSigner**，由各仓库的 Windows 发布任务调用云签名。

最后核对日期：2026-11-09。产品价格、页面按钮和核验要求可能调整；下单以当时订单为准。本文中的公司名称、路径和邮箱示例都必须替换，不能作为真实申请资料提交。本文是运行与维护参考，不是可交给 `harness validate` 的任务 spec。

## 1. 先明确要买什么

需要购买的组合是 **Organization Validation Code Signing + eSigner for Code**。它用于 Windows 程序和安装包，与网站 HTTPS 证书、PDF 文档签名证书不同。SSL.com 当前 OV 产品提供 eSigner 作为密钥存储选项，当前 eSigner 开通指南也明确涵盖 OV，部分旧教程标题中的“EV”不意味着必须升级购买 EV。[OV 产品](https://www.ssl.com/products/software-integrity/code-signing/ov/)、[eSigner 开通指南](https://www.ssl.com/how-to/enroll-esigner-remote-document-ev-code-signing/)

本项目采用以下选择：

| 项目 | 选择 | 为什么这样选 |
| --- | --- | --- |
| 证书类型 | OV Code Signing | 安装时展示经核验的公司名称，适用于普通 Windows 桌面软件 |
| 证书主体 | 实际发行两款软件的香港公司 | 两款产品使用相同且真实的发布者身份 |
| 私钥位置 | eSigner Cloud Signing | GitHub 托管的 Windows runner 可以远程签名 |
| 硬件 token | 不购买，数量为 0 | 此流程不需要插 UKey，也不需要固定一台签名电脑 |
| 自建 HSM | 不选 | 不引入额外云资源和密钥证明流程 |
| 初次购买期限 | 建议先选一年 | 先完成核验及两产品试签，再决定长期购买周期 |
| EV | 本方案不选 | 当前需求是普通桌面安装包，不是申请 Windows 驱动签名 |

SSL.com 的可接受国家/地区代码列表包含 **Hong Kong / HK**。这说明香港可作为申请主体所在地填写，不代表任意香港公司或任意订单必定获批，仍需完成公司的实际核验。[官方地区代码](https://www.ssl.com/country-codes/)

SSL.com 的申请按公司身份核验；产品名字不应填进公司法定名称字段。证书最终发布者可能是 `EXAMPLE TECHNOLOGY LIMITED`，应用名称仍分别是 ClawX 和 ClawX Biz。Windows 中看到公司名称是正常结果。

本方案按“同一法律主体发行两款产品”设计。所核对的 SSL.com 产品及 eSigner 文档没有按软件名称限制一张证书只能签一个产品，但也未找到其单独承诺“无限产品数量”的条款。若公司、品牌归属或签名授权跨主体，先使用第 13 节模板确认适用范围，不能借用另一家公司的身份。

## 2. 管理员提前准备的材料

先建立一份公司内部的“签名申请资料表”。这份表用于核对信息，不放进 Git 仓库，不把身份证件、公司文件或密钥贴到 issue/PR。

| 材料或信息 | 官方要求与本项目建议的区别 | 准备方法 |
| --- | --- | --- |
| 公司完整法定名称 | 官方需要核验组织身份 | 使用现行登记中的英文全称，包含 `LIMITED` 等后缀；不要使用产品名或自行缩写 |
| 公司地址 | 官方需要核验实际地址信息 | 准备与核验资料一致的英文地址；检查室号、楼层、楼宇和街道写法 |
| 注册编号、注册地 | 申请表的公司资料 | 按登记资料填写香港及相应编号；不要将公司注册编号和商业登记编号混为一谈 |
| 可独立核验的公司记录链接 | 官方认可政府机构或可靠第三方数据来源 | 提供指向公司记录的可访问链接；只有企业官网的自述可能不足以完成核验 |
| 公司电话号码 | 官方需要核验且完成回拨 | 准备带国家/地区代码的号码、分机说明和可接听时段；确认核验来源能将号码与公司关联 |
| 联系人 | 官方流程至少添加一名联系人 | 由了解申请且能代表公司处理证书事务的人负责，记录其企业邮箱和职位 |
| D-U-N-S | 官方列为可用于加快验证的信息，非本文视为必填 | 已有则先核对名称、地址、电话是否更新；没有不要为此填写错误号码 |
| CI：公司注册证明书 | **本项目建议备用**，不是官方香港专属必交清单 | 准备清晰版本，用于补充证明法定名称及成立信息 |
| BR：有效商业登记证 | **本项目建议备用** | 检查是否有效；用于补充当前经营主体信息 |
| 最新公司查册资料 | **本项目建议备用** | 用于解释当前名称、地址或注册资料；发生过变更时尤其有用 |
| 英文或双语材料、变更证明 | **本项目建议备用** | 文件若仅中文或信息已变更，等待核验人员说明是否需要翻译或进一步证明 |

SSL.com 的 OV 要求核心是核验组织身份、地址和电话，认可政府记录和可靠第三方记录；不能把“准备 CI、BR”理解成“这两张文件一定足以获批”。其可能进一步索取文件，最终以具体订单的核验要求为准。[官方 OV 要求](https://www.ssl.com/faqs/ssl-ov-validation-requirements/)

### 手上没有公司文件时，去哪里取得

先向公司董事、公司秘书或内部档案负责人索取已有 CI、当前有效 BR 和最新变更资料。如果已有清晰、有效且信息一致的文件，可以先使用已有副本；**不需要为了申请代码签名重复申请一整套政府证明**。下列入口是缺件时的取得途径，是否需要核证本仍以 SSL.com 本次核验要求为准。

1. **CI 公司注册证明书**：从[香港公司注册处 e-Services Portal](https://www.e-services.cr.gov.hk/)进入电子查册服务，查找公司及注册证明书记录；缺少可用副本时可订购注册证明书的核证副本。若公司设立时取得电子证书，先查原提交人的已保存 PDF 或公司档案；官方说明电子证书与纸本具有相同法律效力，不能因为它是 PDF 就认为必须补办纸本。[公司注册处有关证书及核证副本的 FAQ](https://www.cr.gov.hk/en/electronic/e-servicesportal/faq/business-registration.htm)
2. **最新公司查册资料**：同一 e-Services Portal 的 `e-Search` 可查阅公司现况和已登记文件影像，并订购查册报告或文件核证副本。按实际需要取当前公司资料；若公司改过名称、地址，选择能够说明变化的记录。香港已采用 BRN 作为识别和查找公司的主要编号；旧文件只有原 CR No. 时，可使用官方编号对应查询，不要凭猜测把两个编号互换。[电子查册服务及编号对应说明](https://www.cr.gov.hk/en/electronic/e-servicesportal/e-search.htm)
3. **有效 BR 商业登记证的补领或核证本**：从[香港税务局申请商业登记文件说明](https://www.ird.gov.hk/eng/tax/bre_brd.htm)进入其链接的 [GovHK 商业登记服务](https://www.gov.hk/en/business/registration/businesscompany/index.htm)，选择申请商业登记文件及有效商业登记证复本的服务。准备企业名称及商业登记号码，按页面选择有效 BR 的 **Duplicate（电子复本/PDF）**或 **Certified copy（纸本核证副本）**；“商业登记册资料摘录”是另一类资料，不能因名称相近就误认为是 BR 本身。若 SSL.com 没有要求核证本，不预先假设必须购买纸本。是否有效还包括未到期及应缴费用已缴清或获豁免；申请复本本身不能代替处理过期证件。
4. **近期已缴费、只是找不到 BR PDF**：先检查公司使用的 eTAX 账户是否仍可通过 `View/Download Business Registration Certificate` 下载。税务局的遗失证件说明列有这一入口及其可下载期限；超出窗口或无法使用时，再按上一项申请复本。[税务局遗失商业登记证说明](https://www.ird.gov.hk/eng/tax/bre_doc.htm)

以上服务可能收取政府费用，金额、下载窗口和领取方式以申请页面为准；本文不预设固定费用或交付天数。D-U-N-S 仍是可选核验信息，没有现成号码时可先提交政府资料，**无需为代码签名申请先付费找中介办理 D-U-N-S**。若核验人员要求额外材料，再按具体要求补齐。

建议下单前由一人填写、另一人复核以下信息：

1. 两款软件确实由这家香港公司发行，负责人知道该证书会用于这两个仓库。
2. 公司英文名、地址、编号在申请表、登记资料及第三方记录之间一致。
3. 电话不是无人接听的占位号码；前台或秘书知道会有证书核验电话。
4. 联系邮箱可以收到外部邮件，核验人员提出的问题有人处理。
5. D-U-N-S 记录如果过时，先修正记录或使用可核验的其他来源，不提交一套互相冲突的资料。

## 3. 计算费用和签名次数

截至核对日期，OV 证书的一年价格为 **129 美元**。eSigner OV/IV Tier 1 月付为 **20 美元/月，20 次/月**；年付为 **180 美元/年，240 次/年**，超额为 **1 美元/次**。因此一年证书加年付云服务的基础预算约 **309 美元/年**，尚未计税费、汇率和超额使用。不要把年付页面显示的“15 美元/月”等效价格理解成每月有 240 次。[OV 价格](https://www.ssl.com/products/software-integrity/code-signing/ov/)、[eSigner 次数与计费](https://www.ssl.com/guide/esigner-pricing-for-code-signing/)

预算按**实际签名文件和请求**估算，不按用户下载数，也不按 GitHub workflow 次数估算。除应用 EXE、卸载器和最终安装器外，打包内的辅助程序也可能触发签名。当前 hook 只允许 `resources/bin/node.exe`、`resources/bin/uv.exe`、`resources/bin/agent-browser.exe` 保留已有的供应商签名，且必须同时满足 Windows 验签结果为 `Valid` 和具有时间戳；否则仍会签名。`cua-driver.exe` 的 PE 子系统经过本项目修改，必须重新使用本公司身份签名，不能走该保留规则。

因此不能固定按“每个安装包 3 次”预算。单产品 x64 构建可先按 **5–8 次或更多**预留，这只是依据签名覆盖范围的工程预算，**我们尚未实测各 helper 的实际签名状态或一次完整发布的请求数**。以下示例只计算当前默认的 x64；如实际发布 ARM64，再单独测量并相加，不能认为两个架构必然消耗相同：

| 假设 | 示例计算 |
| --- | --- |
| 单产品一次 x64 构建的暂定预算 | 5–8 次或更多 |
| 两个产品都发布 x64 | 10–16 次或更多/发布批次 |
| 每月两批，仅 x64 | 20–32 次或更多/月，约 240–384 次或更多/年 |
| 还发布 ARM64 | 另加实际发布 ARM64 的产品所消耗的次数 |

这个例子即使只含 x64，也已经接近或超过 240 次年额度。**第一轮必须对照实际云签名调用及 eSigner 用量/账单记录统计**，分别记录产品、架构、重跑次数和额度变化，再选择年付 Tier 1 加超额或更高档位。构建失败后的重跑也要纳入预算，不能假设已经消耗的签名次数会退回。

eSigner 当前规则允许在订阅持续有效时结转未用次数，停用会失去结余；试用期和正式账期要分别确认。不要为了短期省月费反复取消服务，否则后续发布可能无法签名。证书有效、eSigner 订阅有效、账户可用是不同条件，续费时都要检查。[计费与结转规则](https://www.ssl.com/guide/esigner-pricing-for-code-signing/)

## 4. 建立账户并完成购买

1. 打开 [SSL.com OV Code Signing 产品页](https://www.ssl.com/products/software-integrity/code-signing/ov/)，检查页面产品名包含 **Code Signing** 和 **OV**。
2. 使用公司指定的负责人建立或登录 SSL.com 账户，记录账户用户名、通知邮箱、恢复方式和费用负责人。账户由公司管理，避免唯一恢复邮箱属于即将离职的个人。
3. 选择一年证书；密钥存储/交付选择 eSigner 云签名。
4. 选择 eSigner 的 OV/IV 档位与月付或年付周期。若界面同时出现 EV 计费表，回到订单摘要确认选择的是 OV。
5. UKey 数量设为 0；不选择自带 HSM；默认不选加急。
6. 核对购物车中的证书数量为 1、公司信息、云服务档位、账期、税费及续费设置。**这一页会产生购买费用，应由费用负责人完成支付。**
7. 保存订单号、发票和付款记录到公司内部资料库。
8. 在订单列表找到刚购买的订单，进入后续资料处理，开始公司核验。

上述购买路径依据官方订单指南；标准核验时间从完整合规材料及回拨完成后计算，官方描述通常为 3–5 天，不是承诺付款后 3–5 天必定签发。云服务不涉及 UKey 的跨境运输。[购买流程与交付说明](https://www.ssl.com/how-to/ordering-process-for-code-and-document-signing-certificates/)

**不需要生成、购买或上传可导出的私钥 PFX。** 本方案的私钥在 eSigner 保管。互联网上让你下载 `.pfx` 并设置 `CSC_LINK` 的旧教程，不能作为这次新购云证书的操作流程；证书的公开部分可查看或下载，不代表私钥可以导出。[官方密钥存储说明](https://www.ssl.com/how-to/ordering-process-for-code-and-document-signing-certificates/)

## 5. 提交公司资料并通过核验

在订单的资料填写入口填入公司注册信息，选择远程签名相关选项，添加至少一名联系人，并按页面要求提交核验来源。D-U-N-S 如果提供，应先检查其记录。OV 申请跳过只适用于 EV 的额外表单，不要为了完成普通 OV 订单去购买或填写 EV 特有申请。[官方核验流程](https://www.ssl.com/how-to/validation-process-for-document-signing-code-signing-and-ev-code-signing-certificates/)

执行时按以下顺序处理，便于发现资料问题：

1. 将申请表每一项与第 2 节资料表逐项对照，再提交。
2. 优先提交可直接核验的记录链接；补充文件按订单提示上传。
3. 记录订单当前状态与缺少的事项，不重复创建多个相同订单。
4. 每个工作日检查订单验证进度、联系人邮箱和垃圾邮件。
5. 收到补件要求时，针对原问题提供资料；地址不一致则解释变更并提供证明，不任意改成另一个地址“试试看”。
6. 名称需要修改时先与核验人员核对，使证书显示的主体与真实登记保持一致。

电话回拨是单独的一步。号码先经核验后，订单页面才出现可执行回拨的入口；可按页面提供的方式安排即时、预约或人工回拨。接听者完成验证码或人工确认后，再看订单是否仍有未完成项目。**单纯填入一个能接短信的个人手机号，不等于它已通过公司的电话核验。**[OV 回拨说明](https://www.ssl.com/how-to/callbacks-for-ov-certificates/)

核验结束的检查点：订单明确通过组织核验，申请主体正确，云签名选项正确，并出现可签发或加入 eSigner 的后续操作。付款成功、订单存在和核验成功不应混为一谈。

## 6. 开通 eSigner，保存自动化所需信息

证书订单通过核验后，在订单详情的 eSigner 开通区域选择 **OTP APP**，设置并保管四位 PIN，随后完成签发及认证器绑定。二维码出现时扫码到认证器，并保存本次自动化所需的 TOTP secret。四位 PIN、短期一次性验证码和 TOTP secret 是三个不同值。[eSigner 开通步骤](https://www.ssl.com/how-to/enroll-esigner-remote-document-ev-code-signing/)

具体保存方法：在二维码展示页找到标为 **`secret code`** 的长期种子，直接复制到公司密码管理器中，再将该值填入两个仓库的 `ES_TOTP_SECRET`。不需要自行解码二维码，也不要填写 Authenticator 当前显示的六位验证码；关闭页面前确认长期种子已经妥善保存。[官方自动签名设置步骤](https://www.ssl.com/how-to/automate-esigner-ev-code-signing/)

| 信息 | 含义 | 本项目如何使用 |
| --- | --- | --- |
| SSL.com 用户名 | 登录身份 | CI 向 eSigner 认证 |
| SSL.com 密码 | 该账户的认证凭据 | CI secret，不能进入日志或仓库 |
| eSigner Credential ID | 选择要用的签名凭据/证书 | 明确指定，避免账户有多张证书时选错 |
| eSigner TOTP secret | 生成签名 OTP 的长期种子 | CI 自动计算签名所需验证码 |
| 认证器当前显示的验证码 | 短期有效的一次性值 | 人工验证时用，**不能**当作长期 CI secret |
| 四位 PIN | 管理 eSigner 登记/二维码等 | 负责人保管，不等于账户密码或 TOTP secret |
| 证书 Subject、CN、序列号、有效期 | 公开证书身份和状态 | 用于核对发布者、续期和验签 |

无人值守签名采用官方支持的 TOTP secret 方式：工具基于种子生成当前验证码，不需要每次构建找人输短信。它不是取消第二因素，也不是把手机上一次显示的六位数字永久保存。TOTP secret 必须与账户和 Credential ID 配对；系统时间也必须准确。[官方自动签名说明](https://www.ssl.com/how-to/automate-esigner-ev-code-signing/)

Credential ID 可以在证书订单详情的签名凭据区域查看。核对其所属账户及证书序列号，别把订单号、证书序列号或证书指纹当作 Credential ID。团队共享一张 OV 证书可以产生额外签名凭据，但数量受订阅档位限制；先使用一套指定的自动化凭据，未来需要分别审计或撤销时再增加凭据。[凭据说明](https://www.ssl.com/guide/esigner-signing-credential-guide/)

公司内部保存一份受限的凭据记录：负责人、订单号、凭据所属账户、Credential ID、证书到期日、使用它的两个仓库、密码/TOTP 的密码管理器条目位置。记录表不直接复制秘密。证书 Subject 与指纹可保存为公开核验资料，TOTP secret 和二维码不可以。

如果二维码页已关闭，按官方查看/重置流程恢复；需要重置时，先安排两个仓库的 secrets 同步更新。重置二维码可能使既有自动化种子失效，不能只更新手机后忘记 CI。[二维码与 PIN 管理](https://www.ssl.com/how-to/view-reset-esigner-qr-code-reset-pin/)

## 7. 两个 GitHub 组织分别配置

ClawX 与 ClawX Biz 即使使用同一张公司证书，也仍然是两个独立的 GitHub 发布环境。一个组织的 organization secret 不会自动变成另一个组织的 secret。最简单的首次接入方式是在两个目标仓库分别创建同名 repository secrets；之后可按各自组织的管理方式调整。

在每个仓库分别进入 `Settings` → `Secrets and variables` → `Actions`，创建本项目要求的秘密与公开配置。保存后 GitHub 不展示秘密原值，更新时以公司密码管理器的记录为准。组织级 secrets 还需要明确允许目标仓库访问；如果使用 environment secrets，workflow 的 job 必须引用相应 environment。[GitHub Secrets 官方说明](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)

### 7.1 配置契约

在两个仓库分别配置下面 **4 个 repository secrets 和 1 个 repository variable**。表中名称必须保持完全一致。

| 名称 | GitHub 类型 | 填入内容 |
| --- | --- | --- |
| `ES_USERNAME` | Secret | SSL.com 实际登录用户名 |
| `ES_PASSWORD` | Secret | 同一账户的密码 |
| `ES_CREDENTIAL_ID` | Secret | 要签名的 eSigner Credential ID |
| `ES_TOTP_SECRET` | Secret | 与上述账户及凭据配对的长期 TOTP secret |
| `WINDOWS_PUBLISHER_NAME` | Variable | 证书的精确 Common Name，例如 `EXAMPLE TECHNOLOGY LIMITED`；不填完整 `CN=..., O=..., C=HK` |

`CLAWX_WINDOWS_SIGNING=1` 由 Windows 发布工作流设置，表示正式启用签名；无需另建同名 secret。`ES_CODE_SIGN_TOOL_PATH` 是安装脚本生成的临时工具目录，也**不要手工保存成 secret**。

#### 第一次如何取得精确发布者名称

不必先签出一个 EXE 才能填写 `WINDOWS_PUBLISHER_NAME`。证书签发后，可以直接读取**公开的终端实体证书（leaf / end-entity certificate）**，不需要获取私钥：

1. 登录 SSL.com，进入 `Orders`，找到本次 OV 代码签名订单，打开 `download` / `details`。
2. 在证书详情中找到已签发的 end-entity 证书，核对序列号与准备使用的 eSigner Credential ID 对应。下载该证书的公开 `.cer` 文件；若下载的是证书包，解压后选自己的公司证书，不要选 SSL.com 的 root / intermediate CA 证书。若页面尚未提供下载，先检查是否已完成签发；无法确定哪个文件是 leaf 时请支持人员确认。
3. 将文件放到本地目录，执行下面的 PowerShell 命令。这里读取证书文件，不会导入 Windows 证书存储，也不会请求云签名。

订单下载入口见 [SSL.com 订单说明](https://www.ssl.com/guide/your-sslcom-account-orders/)，eSigner 的 end-entity 证书及签名凭据位置见[凭据指南](https://www.ssl.com/guide/esigner-signing-credential-guide/)。公开证书与私钥是不同内容；本步骤不需要 `.pfx`。SSL.com 明确说明代码签名私钥不能导出为可下载的 PFX。[代码签名订购说明](https://www.ssl.com/how-to/ordering-process-for-code-and-document-signing-certificates/)

```powershell
$certificatePath = 'C:\Path\To\issued-leaf.cer'
$certificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new(
    (Resolve-Path -LiteralPath $certificatePath).Path
)
try {
    $publisherName = $certificate.GetNameInfo(
        [System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName,
        $false
    )
    if ([string]::IsNullOrWhiteSpace($publisherName)) {
        throw 'The certificate did not provide a publisher name.'
    }
    Write-Output $publisherName
    $certificate | Format-List Subject, Issuer, SerialNumber, NotBefore, NotAfter
} finally {
    $certificate.Dispose()
}
```

把第一行输出的完整 `$publisherName` 原样复制到两个仓库的 `WINDOWS_PUBLISHER_NAME` variable，再核对后面的序列号和有效期。这与本项目签名 hook 使用同一个 `GetNameInfo(SimpleName, false)` 算法；不要从 `Subject` 文本中手工截取，也不要添加 `CN=`、引号或自行调整大小写、标点。`Subject` 等后续输出只用于核对证书身份，不是要填入 variable 的值。

#### 工具与构建流程

这些名字是本项目的统一约定，与 SSL.com 官方示例中的 `CREDENTIAL_ID` 等名字不同。官方支持通过用户名、密码、Credential ID 和 TOTP secret 自动签名；本项目的 hook 负责转换参数。[官方 GitHub Action 参数](https://github.com/SSLcom/esigner-codesign)

仓库内使用以下文件：

| 文件 | 作用 |
| --- | --- |
| `scripts/setup-windows-signing.ps1` | 下载官方 Windows CodeSignTool ZIP，校验仓库固定的 SHA-256，安装到临时目录并设置工具路径 |
| `scripts/windows-signing.cjs` | 检查配置、调用云签名、校验返回文件的签名状态、精确发布者及时间戳 |
| `scripts/windows-builder-config.cjs` | 在原打包配置上启用强制签名及更新签名验证 |
| `scripts/run-electron-builder.mjs` | 在签名模式下接入公共打包配置 |

Windows job 先用 `actions/setup-java@v4` 安装 Temurin Java 17，再运行无参数的 `./scripts/setup-windows-signing.ps1`。安装脚本向 GitHub 的后续步骤导出 `ES_CODE_SIGN_TOOL_PATH`；实际调用使用 Java 17，不使用供应商 ZIP 中捆绑的旧 JDK。ZIP 下载地址可能被供应商替换，摘要不匹配时安装会停止，需要开发人员审核新包后更新固定摘要，不能通过删除校验“修复”。

构建步骤按顺序运行：

```text
node scripts/windows-signing.cjs --check
pnpm run package:win
```

`--check` 仅做本地配置及工具文件检查，不联系 SSL.com，不验证密码是否正确，也不消耗签名次数。`package:win` 会在构建需要时发出真实云签名请求。

社区版的 `Release`、`Package Windows (Manual)` 和 `Windows Build Test` 三个工作流统一使用这套 eSigner 配置，包括预发布版本。它们不再调用原 SignPath 路径，也不提供 SignPath 回退。缺少必需值会失败，不会以未签名产物继续完成发布。日常本地开发不设置签名开关即可继续使用原开发流程。

### 7.2 ClawX Biz 选择正确的上游基线

Biz 的 `clawx_ref` 必须指向已经包含上述四个文件及新版打包 wrapper 的 ClawX 提交、分支或 tag。合并签名改动后，由发布人员选择该提交或之后的基线；不要只更新 Biz 的 secrets，却继续用尚无签名能力的旧 `clawx_ref`。

Biz 会在基线缺少签名支持时明确失败，不能回退到旧配置继续构建未签名安装器。首次迁移建议记录所用上游提交 SHA、Biz 自身提交 SHA 和 workflow run ID，便于复现。公司证书与两个 GitHub 组织之间的关系由各仓库 secrets 建立，不需要把凭据写入上游源码。

### 7.3 配置时的具体检查

1. 在 ClawX 仓库完成一次，再进入 ClawX Biz 仓库单独完成，不能只配置一个组织。
2. secret 值不包含复制时附带的引号、换行或首尾空格。
3. Credential ID 与 TOTP secret 来自同一账户/凭据组合。
4. 发布者名称以实际签发证书为准，不直接填 `ClawX`、GitHub organization 名或申请前猜测的公司简称。
5. 只把 secrets 映射到需要签名的发布或显式手动试签 job；普通拉取请求测试不调用生产签名。
6. 不把账户密码、TOTP、完整环境变量或签名命令参数输出用于排错。
7. 轮换密码或 TOTP 后，按清单同步两个仓库，避免一个发布成功、另一个突然失败。

同一证书由两个仓库调用时，先错开两个生产发布任务进行试签和计费观察。需要隔离访问和故障影响时，为两个仓库建立可分别管理的签名凭据，先核对其额外费用。这是维护建议，不是购买两张产品证书的要求。

## 8. 首次试签与本地验签

初次接入的目标是确认“云服务能签、签的是正确主体、最终发布文件可验证”，先完成测试产物，不立即上传到正式更新渠道。**配套代码的离线验证不包含真实云签名、完整安装或旧版升级验收。** 下面是管理员完成开通后执行的操作；真实试签会消耗计费次数。

### 8.1 优先通过 Windows Build Test 试签

1. 将包含签名改动的测试分支推送到社区仓库，确认该分支中的 workflow 和签名脚本是本次已审核版本。
2. 配好第 7 节的四个 secrets 和一个 variable。
3. 打开仓库 `Actions`，选择 `Windows Build Test`。
4. 点击 `Run workflow`，在分支选择器中选刚推送的测试分支，然后提交运行。不要误选未包含改动的旧分支。
5. 若工作流尚未列出，检查其手动触发定义是否已存在于仓库默认分支；GitHub 对 `workflow_dispatch` 的可见性有默认分支要求，不要通过改成正式 release tag 来代替试签。
6. 先检查工具安装和 `--check` 是否通过；前者不会发出签名请求，后者也不会验证云端账户。
7. 构建开始签名后，记录是否完成，以及 eSigner 用量增加多少；失败先读第 12 节，不连续盲目重跑。
8. 从该 run 的 Artifacts 下载签名产物。这个工作流只上传构建附件，**不会创建 GitHub Release 或发布到正式更新渠道**。
9. 对下载产物执行本节验签和安装测试，再安排 Biz 的对应构建，最后才进入正常 release。

GitHub 手动触发入口及默认分支条件见[手动运行工作流](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)。

### Biz 第一次试签：只构建 Windows 附件

社区版测试通过后，在 Biz 仓库单独执行以下流程。当前 Biz 没有名为 `Windows Build Test` 的工作流，使用的是 `Enterprise Release` 的单平台手动入口：

1. 先将 ClawX 的完整签名改动推送到上游仓库可读取的分支或提交，记录其 SHA；仅存在于本地的提交不能被远端 runner checkout。确认它包含第 7.1 节列出的四个文件及实际接入签名的新版 wrapper。
2. 将 Biz 签名改动推送到 Biz 仓库的测试分支。**尚未推送时，GitHub 的分支选择器里不会出现这个测试分支。**
3. 配好 Biz 自己的四个 secrets 和 `WINDOWS_PUBLISHER_NAME` variable。打开 Biz 仓库 `Actions` → `Enterprise Release` → `Run workflow`，选择刚推送的 **Biz 测试分支**。
4. 按下表填写输入，再提交运行。不要通过创建 release tag 触发首次试签，也不要保留 `platform` 默认值 `all`。

| 输入 | 首次试签填写方式 |
| --- | --- |
| `version` | 填一个符合企业版规则、用于本次测试的版本，例如 `0.3.9-biz.99`；按当前产品基线选实际测试版本，不照抄示例作为正式版本 |
| `clawx_ref` | **明确填写**第 1 步已推送的完整签名 SHA 或分支名；不要留空，留空会从 `version` 自动推导旧的上游版本 tag |
| `platform` | 显式选择 **`win`** |
| `auth_gateway_url` | 填本次安装测试所需的正确企业认证网关 URL；它会写入安装包，不能为了运行工作流而随意填示例地址 |

5. 检查 Windows job 的上游基线校验、Java/工具准备、本地 `--check` 以及签名构建结果；记录本次实际计费次数。
6. 成功后在 run 的 Artifacts 下载 **`release-win`**。按本节后续步骤检查签名、安装及升级，不把测试附件手工上传到正式更新渠道。
7. 检查 `publish` 和 `upload-oss` 两个 job 均为跳过状态，再记录 Biz SHA、上游 SHA、版本及 run ID。

上述“只产生构建附件”的行为来自当前 Biz 仓库 `.github/workflows/release.yml`：手动选择 `win` 时只进入 Windows 构建矩阵；`publish` 和 `upload-oss` 的条件均要求平台输入为空或为 `all`，因此不会创建 GitHub Release 或上传企业 OSS。tag 触发的输入为空，默认 `all` 也会满足发布条件，所以都不用于首次试签。今后若修改该工作流，重新核对这两个 job 的条件后再按此流程运行。手动入口同样受 GitHub 默认分支中的 `workflow_dispatch` 可见性要求约束。

### 8.2 在 Windows 本地准备工具

本地排错需要符合仓库要求的 Node/pnpm、已安装的项目依赖，以及 Java 17。以下操作在**同一个 PowerShell 窗口、ClawX 仓库根目录**执行；`JAVA_HOME` 指向本机真实安装的 Java 17 根目录：

```powershell
$env:JAVA_HOME = 'C:\Path\To\Your\Java17'
& "$env:JAVA_HOME\bin\java.exe" -version
./scripts/setup-windows-signing.ps1

$env:CLAWX_WINDOWS_SIGNING = '1'
$env:WINDOWS_PUBLISHER_NAME = Read-Host 'Exact certificate common name'

foreach ($secretName in @('ES_USERNAME', 'ES_PASSWORD', 'ES_CREDENTIAL_ID', 'ES_TOTP_SECRET')) {
    $secretInput = Read-Host $secretName -AsSecureString
    $secretValue = [System.Net.NetworkCredential]::new('', $secretInput).Password
    [System.Environment]::SetEnvironmentVariable($secretName, $secretValue, 'Process')
    $secretValue = $null
    $secretInput.Dispose()
}

node scripts/windows-signing.cjs --check
```

该例通过不回显的提示读入凭据，避免将真实秘密写入 shell 命令历史。成功只说明本地前置条件齐全；关闭窗口后环境值不再用于后续会话。不要运行 `Get-ChildItem Env:` 或打开详细进程参数日志来排查秘密。

准备好后，执行下面的命令会生成本地签名安装包并消耗云签名次数，不会发布远端 release：

```powershell
pnpm run package:win
```

如要先测一个小型自有 EXE，沿用 `windows-signing.cjs` 导出的同一 hook，而不是另建一套不同参数的签名命令。将测试文件复制到临时目录，并在 Node 调用中传入真实文件路径：

```powershell
$env:CLAWX_SIGNING_TEST_FILE = 'D:\signing-test\YourOwnApp.exe'
@'
const sign = require('./scripts/windows-signing.cjs');
sign({
  path: process.env.CLAWX_SIGNING_TEST_FILE,
  hash: 'sha256',
  isNest: false,
}).catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
'@ | node -
if ($LASTEXITCODE -ne 0) { throw 'Test signing failed.' }
```

这条命令会签名并替换指定测试副本，不调用发布接口。验证结束后关闭本次终端；如果继续使用此窗口开发，应先清除 `CLAWX_WINDOWS_SIGNING` 和本节注入的 `ES_*` 凭据，避免后续本地打包继续消耗生产签名额度。

### 8.3 试签顺序

1. 取得一个本项目构建的小型自有 Windows EXE 副本，避免用已发布版本或第三方程序作练习。
2. 使用第 8.2 节的公共 hook 调用进行一次真实签名，记录用量变化；这会消耗生产签名额度。
3. 验证签名状态、公司主体和时间戳。
4. 按当前默认架构打包一个完整 x64 安装器，检查应用、卸载器和安装器的签名覆盖。
5. 覆盖所有实际发布的架构；**如发布 ARM64，再另行完成 ARM64 试签和验证**。不发布 ARM64 时无需为本次接入增加该架构。注意在 x64 构建主机上签 ARM64 文件与在 ARM64 主机运行工具是两回事。
6. 对另一个产品的所有实际发布架构重复完整安装器验证；不能因为一个仓库成功就跳过第二个。
7. 通过后再允许正常正式发布。

### 8.4 用 PowerShell 检查文件

以下是独立验签命令，不含账户秘密。将路径换成**本次实际输出文件**：

```powershell
$installerPath = 'D:\build-output\YourApp-Setup.exe'
$signature = Get-AuthenticodeSignature -LiteralPath $installerPath
$signature | Format-List Status, StatusMessage, Path
$signature.SignerCertificate | Format-List Subject, Issuer, SerialNumber, Thumbprint, NotBefore, NotAfter
$signature.TimeStamperCertificate | Format-List Subject, Issuer, NotBefore, NotAfter

if ($signature.Status -ne 'Valid') {
    throw "Installer signature is not valid: $($signature.Status)"
}
if ($null -eq $signature.TimeStamperCertificate) {
    throw 'Installer does not contain a timestamp certificate.'
}
```

`Valid` 表示当前 Windows 信任判断通过；还要人工确认 Subject 是自己的公司。如果输出 `NotSigned`，停止发布；如果是证书链或信任错误，继续调查，而不是把验证脚本改成忽略错误。[Get-AuthenticodeSignature](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.security/get-authenticodesignature?view=powershell-7.5)

安装 Windows SDK 后，也可用 SignTool 检查 Authenticode 签名及所有签名记录：

```powershell
signtool verify /pa /all /v 'D:\build-output\YourApp-Setup.exe'
```

检查输出中的签名证书、证书链和时间戳，并检查退出码。验签本身不需要 SSL.com 凭据。[Microsoft SignTool](https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool)

### 8.5 完整安装验证

在 Windows 测试机或干净虚拟机执行：

1. 通过预期下载入口取得安装包，保留实际浏览器下载场景。
2. 右键安装包，查看数字签名及发布者；必要时用上述命令再次核对。
3. 安装到新的用户目录，启动应用，验证基本窗口和入口可用。
4. 找到安装后的应用 EXE 和卸载程序，对两者分别验签。
5. 卸载一次，检查卸载流程是否完整。
6. 保留版本、架构、文件 SHA-256、签名 Subject、时间戳及验证结果，作为本次试签记录；不要附带秘密或证件材料。

只检查最外层 Setup EXE 不够：它不能代替验证安装后实际运行的程序。不要先生成更新校验文件，再对安装器补签后直接上传；签名会改变文件内容，更新元数据必须描述最终签名后的产物。本仓库在 electron-builder 的签名 hook 中执行签名，使后续 blockmap 和更新元数据基于最终文件生成。

当前只对 `resources/bin/` 下的 `node.exe`、`uv.exe`、`agent-browser.exe` 保留已有的 `Valid` 且带时间戳的供应商签名，其发布者可能不是本公司；不满足条件的文件仍需签名。这不是对任意已签名第三方 EXE 的通用跳过规则。经过 PE 修改的 `cua-driver.exe` 必须重新签名。应用本体、安装器和卸载器也必须使用本项目指定的发布者，不能以“目录里有一个有效签名的第三方 EXE”代替它们的验签。

## 9. 旧版本自动升级与发布者迁移

ClawX 原有版本可能使用不同签名主体，ClawX Biz 的旧版本也可能未签名。接入新证书时，必须测试从**已经发布给用户的旧版**升级，不能只验证新安装。

建议保存一份迁移测试表：

| 起点 | 终点 | 必查项目 |
| --- | --- | --- |
| ClawX 当前正式旧版 | 首个 SSL.com 签名版 | 能获取更新、下载完整、校验通过、安装成功、数据保留 |
| ClawX 首个 SSL.com 签名版 | 下一测试版本 | 新签名身份稳定，更新仍通过 |
| ClawX Biz 当前正式旧版 | 首个签名版 | 未签名历史版本能否正常接收升级、安装器行为是否变化 |
| 如实际发布 ARM64：该产品的已发布 ARM64 旧版 | 对应 ARM64 新版 | 另行验证 ARM64 升级，架构和更新渠道没有串用；首次提供该架构时验证新安装 |

这里的风险不只是 Windows 是否认可新证书，还包括旧客户端是否只接受原发布者名称。开发人员应检查旧产物内的 `app-update.yml` 和所用 updater 验证逻辑；不能仅修改新版本配置，就假设已经安装的旧客户端会自动接受新主体。若旧版拒绝，应安排经过验证的过渡版本或明确的手工升级路径，不通过关闭所有签名校验来掩盖问题。

两个仓库沿用各自的产品标识、版本和更新地址；共用签名证书不意味着共用自动更新渠道。由同一个公司签名的两个安装器仍需要分别发布及测试。

## 10. Windows 安全提示的预期

签名首先解决的是发布者身份和文件完整性。有效证书能让 Windows 显示已核验公司名称，但 **SmartScreen 对新文件的信誉提示仍可能出现**。微软当前明确说明 OV、Artifact Signing 及 EV 都需要积累信誉，EV 已不再保证首发免提示。不要在发布文案里承诺“签名后所有电脑都不再弹安全提示”。[微软签名方案说明](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options)

验收时分别记录：

| 现象 | 应如何判断 |
| --- | --- |
| 显示已验证的正确公司名 | 发布者身份生效 |
| 仍出现 SmartScreen 的新应用提示 | 再检查签名有效性；有效签名与文件信誉是两个层面 |
| 出现 UAC 权限确认 | 按安装权限需求判断，不等于签名失败 |
| 显示未知发布者或 `NotSigned` | 检查是否拿错产物、签名漏执行或后续文件又被修改 |
| Defender 报恶意软件 | 独立调查报毒及提交样本复核，不能仅以“已签名”判断为误报 |

## 11. 续期、轮换与日常维护

每次正式发布前检查证书有效期、eSigner 订阅、剩余次数和两仓库配置。建议公司在证书到期前至少一个月安排续期准备，这个提前量是本项目的运维安排，不是供应商保证的处理时限。

SSL.com 的续期会产生新证书，可能重新进行组织及电话验证。多年份订单不等于单张证书拥有同等年限；自 2026-03 起公开信任代码签名证书最长有效期受 458 天上限约束。具体证书可能更短，因此以实际 `NotAfter` 为准。[续期与有效期规则](https://www.ssl.com/how-to/renewing-ev-ov-and-iv-certificates/)

续期或重签发时按以下顺序操作：

1. 更新公司核验资料，确认公司名和地址没有未经处理的变更。
2. 完成新证书签发及 eSigner 所需登记。
3. 核对新的 Credential ID、Subject、序列号和有效期，不假设全部沿用旧值。
4. 更新两个仓库的相关配置；保留变更日期和负责人。
5. 做一次小文件试签，再做完整安装及旧版升级检查。
6. 确认新凭据可用后，按实际需要撤销旧访问，避免误撤销仍需保留的证书。

始终使用可信时间戳。它提供签名发生在证书有效期内的证据，避免把证书自然到期简单等同为已发布软件全部失效；吊销、文件修改和系统信任变化仍需分别处理。正常续期不要为了“清理旧证书”随意吊销旧证书。

TOTP/密码轮换也需要按同一清单覆盖两个组织。如果怀疑签名凭据泄露，先停用受影响的签名访问并联系供应商，保留签名记录；随后根据影响决定证书处置。凭据停用与证书吊销不是同一操作。[eSigner 凭据管理](https://www.ssl.com/guide/esigner-signing-credential-guide/)

## 12. 常见故障与处理顺序

| 故障 | 首先检查 | 下一步 |
| --- | --- | --- |
| 公司核验卡住 | 名称、地址、编号和公开资料是否一致 | 阅读原订单补件要求，带订单号联系核验支持 |
| 找不到回拨入口 | 公司电话号码是否已核验 | 补充可核验电话来源，不反复尝试随机号码 |
| 无法完成回拨 | 电话区号、分机、前台转接、时段 | 预约人工回拨并说明可接听方式 |
| 账户可登录但签名失败 | eSigner 是否 active、凭据是否归属正确账户 | 核对 Credential ID、证书状态及订阅 |
| `invalid otp` | TOTP 是否属于该账户和凭据、机器时间 | 同步时间；如重置过二维码，同步更新两个仓库的 secret |
| 一个仓库成功另一个失败 | 两边 secret/variable 名、可访问范围和工作流分支 | 对照第 7.1 节配置契约，不打印 secret 原文 |
| 工具提示选择证书或等待输入 | Credential ID/TOTP 映射是否缺失 | 修复无人值守参数，不在 CI 中等待手机输入 |
| 额度不足 | eSigner 用量和档位 | 按已批准预算追加次数或调整档位，避免反复重跑 |
| 签名成功但 `NotSigned` | 验证的文件是否为签名输出 | 检查构建路径与后续覆盖步骤 |
| 本机有效、用户机器失败 | 实际下载文件的哈希、证书链、时间戳 | 在干净 Windows 环境复现，不要求用户全局关闭安全防护 |
| 自动更新校验失败 | 是否签名后修改了安装器、元数据是否对应最终文件 | 重建正确产物和更新元数据，执行迁移测试 |
| 新版更新提示发布者不匹配 | 旧客户端信任的发布者与新证书 Subject | 处理证书迁移，不直接永久禁用验证 |

`invalid otp` 的账户配对和系统时间检查来自官方自动签名文档；其他检查顺序是本项目针对双仓库发布的排障建议。[OTP 排障依据](https://www.ssl.com/how-to/automate-esigner-ev-code-signing/)

向支持团队提交问题时可提供：订单号、证书序列号、失败时间和时区、工具版本、经过脱敏的错误、文件类型与大小、请求的目标操作。不要发账户密码、TOTP secret、认证器二维码或未经要求的个人证件。

## 13. 购买前咨询邮件模板

以下是可复制给 SSL.com 销售/支持的询问草稿。**本文不会发送邮件，也不代表已经得到供应商确认。** 把方括号替换为实际内容；初次咨询不用附全部公司证件。

```text
Subject: Hong Kong company — OV Code Signing with eSigner for two Electron apps

Hello SSL.com team,

We are a company incorporated in Hong Kong:
Legal company name: [FULL REGISTERED ENGLISH NAME]
Company registration number: [NUMBER]
Company website: [URL]

We publish two Windows Electron applications, ClawX and ClawX Biz,
under this same legal entity. Their source repositories are hosted
in two separate GitHub organizations.

We would like to use one OV Code Signing certificate with eSigner
cloud key storage and unattended signing on GitHub-hosted Windows
runners. We do not need a physical USB token or kernel driver signing.

Please confirm:
1. Can our Hong Kong entity apply for this OV + eSigner combination?
2. Which organization and telephone-validation records do you require?
   We can provide our CI, current BR, and company-search records if needed.
3. Can the same certificate sign both products, including their application
   executables, uninstallers, and NSIS installers, from both repositories?
4. Is unattended signing through CodeSignTool and a TOTP secret available
   for this OV subscription? Are there any CI concurrency restrictions?
5. Is a separate signing credential required for each repository or runner?
   If so, please specify the additional fee.
6. Please confirm how signatures, retries, and batch requests are counted.
7. Our largest installer is approximately [SIZE] MB. Please confirm the
   supported signing route and any file-size limits for it.
8. Please confirm the final first-year price, renewal price, included
   signing quota, overage fee, and certificate reissuance process.

Our expected usage is approximately [COUNT] file signatures per month.
Please advise if any additional requirements apply before we purchase.

Thank you,
[NAME / ROLE]
[COMPANY EMAIL]
```

## 14. 上线完成的判定

以下各项全部完成，才将此次签名接入视为可用于正式发布：

- 香港公司核验通过，证书主体正确，eSigner 已启用。
- 凭据由公司保管，两个目标仓库分别完成配置。
- 正式发布任务在缺少签名配置或验签失败时停止，不静默发布未签名安装器。
- 两产品所有实际发布架构的最终产物均已检查签名、发布者和时间戳；当前默认 x64，如发布 ARM64，另行验证该架构。
- 安装后的应用与卸载程序也已验证。
- 从已发布旧版本升级的路径经过测试，尤其是 ClawX 原签名主体迁移。
- 更新元数据对应最终签名文件，正式渠道只包含本次核验过的产物。
- 实测签名次数已记录，续期及两仓库凭据轮换有人负责。

签名文件可验证与 SmartScreen 暂时没有警告，应作为不同的验收记录。没有公司证书及真实凭据时，可以验证代码和工作流，但不能声称已经完成真实签名或信誉验证。
