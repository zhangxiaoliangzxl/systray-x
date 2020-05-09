/* eslint-disable object-shorthand */

const Ci = Components.interfaces;

// Get various parts of the WebExtension framework that we need.
var { ExtensionCommon } = ChromeUtils.import(
  "resource://gre/modules/ExtensionCommon.jsm"
);

// You probably already know what this does.
var { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");
var { MailServices } = ChromeUtils.import(
  "resource:///modules/MailServices.jsm"
);
var { fixIterator } = ChromeUtils.import(
  "resource:///modules/iteratorUtils.jsm"
);

// ChromeUtils.import() works in experiments for core resource urls as it did
// in legacy add-ons. However, chrome:// urls that point to add-on resources no
// longer work, as the "chrome.manifest" file is no longer supported, which
// defined the root path for each add-on. Instead, ChromeUtils.import() needs
// a url generated by
//
// let url = context.extension.rootURI.resolve("path/to/file.jsm")
//
// Instead of taking the extension object from the context, you may generate
// the extension object from a given add-on ID as shown in the example below.
// This allows to import a JSM without context, for example inside another JSM.
//
var { ExtensionParent } = ChromeUtils.import(
  "resource://gre/modules/ExtensionParent.jsm"
);
var extension = ExtensionParent.GlobalManager.getExtension(
  "systray-x@Ximi1970"
);
var { folderChange } = ChromeUtils.import(
  extension.rootURI.resolve("modules/folderChange.jsm")
);

// This is the important part. It implements the functions and events defined in schema.json.
// The variable must have the same name you've been using so far, "myapi" in this case.
var folderChange = class extends ExtensionCommon.ExtensionAPI {
  getAPI(context) {
    console.log("folderChange module started");

    // To be notified of the extension going away, call callOnClose with any object that has a
    // close function, such as this one.
    context.callOnClose(this);

    //
    //  Setup folder listener
    //
    SysTrayX.init();

    return {
      // Again, this key must have the same name.
      folderChange: {
        setCountType: async function (type) {
          SysTrayX.setCountType(type);
        },

        setFilters: async function (filters) {
          SysTrayX.setFilters(filters);
        },

        onUnreadMailChange: new ExtensionCommon.EventManager({
          context,
          name: "folderChange.onUnreadMailChange",
          // In this function we add listeners for any events we want to listen to, and return a
          // function that removes those listeners. To have the event fire in your extension,
          // call fire.async.
          register(fire) {
            function callback(event, unread) {
              return fire.async(unread);
            }

            SysTrayX.add(callback);
            return function () {
              SysTrayX.remove(callback);
            };
          },
        }).api(),
      },
    };
  }

  close() {
    /*
     *  Remove the folder listener
     */
    SysTrayX.shutdown();

    // This function is called if the extension is disabled or removed, or Thunderbird closes.
    // We registered it with callOnClose, above.
    console.log("folderChange module closed");

    // Unload the JSM we imported above. This will cause Thunderbird to forget about the JSM, and
    // load it afresh next time `import` is called. (If you don't call `unload`, Thunderbird will
    // remember this version of the module and continue to use it, even if your extension receives
    // an update.) You should *always* unload JSMs provided by your extension.
    Cu.unload(extension.getURL("modules/folderChange.jsm"));
  }
};

// A helpful class for listening to windows opening and closing.
// (This file had a lowercase E in Thunderbird 65 and earlier.)
var { ExtensionSupport } = ChromeUtils.import(
  "resource:///modules/ExtensionSupport.jsm"
);

var SysTrayX = {
  MESSAGE_COUNT_TYPE_UNREAD: 0,
  MESSAGE_COUNT_TYPE_NEW: 1,

  countType: this.MESSAGE_COUNT_TYPE_UNREAD,

  initialized: false,

  accounts: undefined,
  filters: undefined,

  currentMsgCount: null,
  newMsgCount: null,

  callback: undefined,

  init: function () {
    if (this.initialized) {
      console.warn("Folder listener already initialized");
      return;
    }

    console.log("Initializing folder listener");

    //  Get the mail accounts using MailServices
    this.getAccounts();

    //  Start listener
    MailServices.mailSession.AddFolderListener(
      this.mailSessionListener,
      this.mailSessionListener.notificationFlags
    );

    this.initialized = true;
  },

  shutdown: function () {
    if (!this.initialized) {
      return;
    }

    log.log("Shutting down folder listener");

    //  Stop listener
    MailServices.mailSession.RemoveFolderListener(this.mailSessionListener);

    this.initialized = false;
  },

  setCountType: function (type) {
    console.debug("setCountType: " + type);

    if (type === 0) {
      this.countType = this.MESSAGE_COUNT_TYPE_UNREAD;
    } else if (type === 1) {
      this.countType = this.MESSAGE_COUNT_TYPE_NEW;
    } else console.log("Unknown count type: " + type);

    //  Update count
    this.updateMsgCountWithCb();
  },

  setFilters: function (filters) {
    this.filters = filters;

    //  Update count
    this.updateMsgCountWithCb();
  },

  mailSessionListener: {
    notificationFlags:
      Ci.nsIFolderListener.propertyFlagChanged |
      Ci.nsIFolderListener.boolPropertyChanged |
      Ci.nsIFolderListener.intPropertyChanged,

    OnItemIntPropertyChanged(item, property, oldValue, newValue) {
      // TotalUnreadMessages, BiffState (per server)
      /*
      console.debug(
        "OnItemIntPropertyChanged " +
          property +
          " for folder " +
          item.prettyName +
          " was " +
          oldValue +
          " became " +
          newValue +
          " NEW MESSAGES=" +
          item.getNumNewMessages(true)
      );
      */
      this.onMsgCountChange(item, property, oldValue, newValue);
    },

    OnItemBoolPropertyChanged: function (item, property, oldValue, newValue) {
      // NewMessages (per folder)
      /*
      console.debug(
        "OnItemBoolPropertyChanged " +
          property +
          " for folder " +
          item.prettyName +
          " was " +
          oldValue +
          " became " +
          newValue +
          " NEW MESSAGES=" +
          item.getNumNewMessages(true)
      );
      */
      this.onMsgCountChange(item, property, oldValue, newValue);
    },

    OnItemPropertyFlagChanged: function (item, property, oldFlag, newFlag) {
      /*
      console.debug(
        "OnItemPropertyFlagChanged" +
          property +
          " for " +
          item +
          " was " +
          oldFlag +
          " became " +
          newFlag
      );
      */
      this.onMsgCountChange(item, property, oldFlag, newFlag);
    },

    onMsgCountChange: function (item, property, oldValue, newValue) {
      let msgCountType = SysTrayX.countType;

      let prop = property.toString();
      if (
        prop === "TotalUnreadMessages" &&
        msgCountType === SysTrayX.MESSAGE_COUNT_TYPE_UNREAD
      ) {
        SysTrayX.updateMsgCountWithCb();
      } else {
        if (
          prop === "NewMessages" &&
          msgCountType === SysTrayX.MESSAGE_COUNT_TYPE_NEW
        ) {
          if (oldValue === true && newValue === false) {
            // https://bugzilla.mozilla.org/show_bug.cgi?id=727460
            item.setNumNewMessages(0);
          }
          SysTrayX.updateMsgCountWithCb();
        }
      }
    },
  },

  updateMsgCountWithCb(callback) {
    if (callback === undefined || !callback) {
      callback = function (currentMsgCount, newMsgCount) {
        // default
        //        .updateIcon(newMsgCount);
        console.debug("Update icon: " + newMsgCount);

        if (SysTrayX.callback) {
          SysTrayX.callback("unread-changed", newMsgCount);
        }
      };
    }

    let msgCountType = SysTrayX.countType;
    if (msgCountType === SysTrayX.MESSAGE_COUNT_TYPE_UNREAD) {
      this.countMessages("UnreadMessages");
    } else if (msgCountType === SysTrayX.MESSAGE_COUNT_TYPE_NEW) {
      this.countMessages("HasNewMessages");
    } else console.error("Unknown message count type: " + msgCountType);

    // currentMsgCount and newMsgCount may be integers or bool, which do
    // also support comparison operations
    callback.call(this, this.currentMsgCount, this.newMsgCount);
    this.currentMsgCount = this.newMsgCount;
  },

  countMessages(countType) {
    console.debug("countMessages: " + countType);

    this.newMsgCount = 0;
    for (let accountServer of this.accounts) {
      //      if (accountServer.type === ACCOUNT_SERVER_TYPE_IM) {
      //        continue;
      //      }

      //      if (excludedAccounts.indexOf(accountServer.key) >= 0)
      //      {
      //        continue;
      //      }

      this.applyToSubfolders(
        accountServer.prettyName,
        accountServer.rootFolder,
        true,
        function (folder) {
          this.msgCountIterate(countType, accountServer.prettyName, folder);
        }
      );
    }

    console.debug("Total " + countType + " = " + this.newMsgCount);
  },

  applyToSubfolders(account, folder, recursive, fun) {
    if (folder.hasSubFolders) {
      let subFolders = folder.subFolders;
      while (subFolders.hasMoreElements()) {
        let subFolder = subFolders.getNext().QueryInterface(Ci.nsIMsgFolder);
        if (recursive && subFolder.hasSubFolders)
          this.applyToSubfoldersRecursive(account, subFolder, recursive, fun);
        else fun.call(this, subFolder);
      }
    }
  },

  applyToSubfoldersRecursive(account, folder, recursive, fun) {
    fun.call(this, folder);
    this.applyToSubfolders(account, folder, recursive, fun);
  },

  msgCountIterate(type, account, folder) {
    const match = SysTrayX.filters?.filter(
      (filter) =>
        filter.folder.accountName === account &&
        filter.folder.name === folder.prettyName
    );

    const count = match
      ? match.length > 0
      : folder.getFlag(Ci.nsMsgFolderFlags.Inbox);

    if (count) {
      SysTrayX["add" + type](folder);
    }
  },

  addUnreadMessages(folder) {
    let folderUnreadMsgCount = folder["getNumUnread"](false);

    console.debug(
      "folder: " +
        folder.prettyName +
        " folderUnreadMsgCount= " +
        folderUnreadMsgCount
    );

    /* nsMsgDBFolder::GetNumUnread basically returns mNumUnreadMessages +
      mNumPendingUnreadMessages, while mNumPendingUnreadMessages may get -1
      when updated from the cache. Which means getNumUnread might return -1. */
    if (folderUnreadMsgCount > 0) {
      this.newMsgCount += folderUnreadMsgCount;
    }
  },

  addHasNewMessages(folder) {
    let folderNewMsgCount = folder.hasNewMessages;

    console.debug(
      "folder: " + folder.prettyName + " hasNewMessages= " + folderNewMsgCount
    );

    this.newMsgCount = this.newMsgCount || folderNewMsgCount;
  },

  getAccounts() {
    console.debug("getAccounts");

    let accountServers = [];
    for (let accountServer of fixIterator(
      MailServices.accounts.accounts,
      Ci.nsIMsgAccount
    )) {
      accountServers.push(accountServer.incomingServer);
    }

    for (let i = 0, len = accountServers.length; i < len; ++i) {
      console.debug(
        "ACCOUNT: " +
          accountServers[i].prettyName +
          " type: " +
          accountServers[i].type +
          " key: " +
          accountServers[i].key.toString()
      );
    }

    //  Store the accounts
    this.accounts = accountServers;
  },

  add(callback) {
    this.callback = callback;
  },

  remove(callback) {
    this.callback = undefined;
  },
};
