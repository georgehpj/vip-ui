"use strict";
const gulp = require("gulp");
const rjs = require('requirejs');
const concat = require('gulp-concat');
const uglify = require('gulp-uglify');
const sourcemaps = require('gulp-sourcemaps');
const rename = require('gulp-rename');
const clean = require('gulp-clean');
//扫描文件路径
const through2 = require('through2');
//html内资源路径替换
const htmlReplace = require("gulp-html-replace");
//保证任务的同步执行
const sequence = require("gulp-sequence");
const crypto = require('crypto');
const Server = require('karma').Server;
const revHash = require('gulp-rev-hash');
const webServer = require('gulp-webserver');
const sass = require('gulp-sass');

const gulpWatch = require("gulp-watch");

//var requirejsConfig = require('./js/requirejs-config.js').RJSConfig;

const configSrc = "config/common-config.js";
const requireConfigJsDist = "plugins";
const requireConfigJsName = "requirejs-config.js";
const requireConfigJsOutputSrc = 'js/requirejs-config.js';
let optimize = "none";
let verMap = {};
let totalFileNum = 0;
let root = '';

//根据文件内容计算md5串
const __getDataMd5 = function (data) {
    return crypto.createHash('md5').update(data).digest('base64');
};

//获取requireCOnfig中的paths JSON对象
const __getRequireConfigPaths = function (file) {
    let configContents = file.contents.toString();
    let matches = /"paths": (\{[^}]*}),/.exec(configContents);
    return JSON.parse(matches[1]);
};

//js合并压缩
const __rjsOptimize = function (name, out, done) {
    return rjs.optimize({
        baseUrl: "./",
        mainConfigFile: configSrc,
        name: name,
        out: out,
        optimize: optimize,
        generateSourceMaps: optimize != "none",
        preserveLicenseComments: false,
        //公共模块不压缩
        exclude: ["jquery", 'bootstrap', "comm"]
    }, function () {
        console.log(name + ":" + out + " is OK!");
        done();
    });
};

//入口文件building
const __buildEntry = function (file, moduleName, entryName, done) {
    let outSrc = './dist/' + file + '/js/' + entryName + ".js";
    __rjsOptimize(moduleName, outSrc, done);
};

//模块文件building
const __buildModules = function (file, moduleName, entryName, done) {
    let outSrc = './dist/' + file + '/js/module/' + entryName + ".js";
    __rjsOptimize(moduleName, outSrc, done);
};

//组件building
const __buildComponents = function (path, moduleName, entryName, done) {
    let outSrc = './dist/components/' + path + '/' + entryName + ".js";
    __rjsOptimize(moduleName, outSrc, done);
};

//根据config生成requirejs-config.js
const __buildRequireConfigJs = function () {
    let modules = ["config/common-config.js"];
    if (arguments.length > 0) {
        modules = modules.concat(Array.prototype.slice.call(arguments, 0));
    }
    if (optimize === "uglify2") {
        return gulp.src(modules)
            .pipe(sourcemaps.init())
            .pipe(concat(requireConfigJsName))
            .pipe(uglify())
            .pipe(sourcemaps.write("./"))
            .pipe(gulp.dest(requireConfigJsDist))
    } else {
        return gulp.src(modules)
            .pipe(concat(requireConfigJsName))
            .pipe(gulp.dest(requireConfigJsDist))
    }
};

gulp.task('_buildScss', function () {
    gulp.src('./vip-ui/src/stylesheets/vip-ui.scss')
        .pipe(sass().on('error', sass.logError))
        .pipe(gulp.dest('./vip-ui/src/stylesheets/'));
});

//在命令行执行：gulp sass:watch，就可实现监听文件变化来自动编译
gulp.task('scssWatcher', function () {
    gulp.watch('./vip-ui/src/stylesheets/**/*.scss', ["_buildScss"]);
});

//根据paths JSON对象生成[{moduleName:MD5}]对照关系verMap
gulp.task("__createMD5VerMap", function (cb) {
    gulp.src(configSrc)
        .pipe(through2.obj(function (file, encoding, done) {
                let paths = __getRequireConfigPaths(file);
                //将through2异步操作封装成promise对象，利用Promise.all等待所有through2异步任务执行完毕后调用gulp.task的callback
                totalFileNum = Object.keys(paths).length;
                let promises = [];
                for (let moduleName in paths) {
                    let filePath = './' + root + paths[moduleName];
                    let suffix = '';
                    if (/([Cc]ss$)/.test(moduleName)) {
                        filePath = './' + root + paths[moduleName] + '.css';
                        suffix = '.css'
                    } else if (!/(\.html$)/.test(filePath)) {
                        filePath = './' + root + paths[moduleName] + '.js';
                        suffix = '.js'
                    }
                    promises.push(
                        new Promise(function (resolve) {
                            gulp.src(filePath)
                                .pipe(through2.obj(function (file) {
                                        verMap[moduleName] = paths[moduleName] + suffix + "?v=" + __getDataMd5(file.contents).slice(0, 6);
                                        resolve();
                                    }, function () {
                                        //不处理失败任务
                                        console.log("未获取到文件：" + paths[moduleName])
                                        verMap[moduleName] = paths[moduleName];
                                        resolve();
                                    })
                                )
                        })
                    );
                }
                Promise.all(promises).then(function () {
                    cb();
                });
            })
        );
});

//将[{moduleName:MD5}]对照关系verMap写入requireConfig.js配置文件中
gulp.task("__modifyRequireConfig", ["__createMD5VerMap"], function () {
    return gulp.src(requireConfigJsOutputSrc)
        .pipe(through2.obj(function (file, encoding, done) {
            if (totalFileNum !== Object.keys(verMap).length) {
                throw Error("打包前后配置项个数不一致！");
            }
            let contents = file.contents.toString();
            contents = contents.replace(/"?paths"?\s*:\s*(\{[^}]*}),/, '"paths":' + JSON.stringify(verMap) + ',');
            /*contents = contents.replace("var timestamp;", "var timestamp = 'v="
             + new Date().getTime() + "';");*/
            file.contents = new Buffer(contents);
            this.push(file);
            done();
        }))
        .pipe(rename(requireConfigJsName))
        .pipe(gulp.dest(root + requireConfigJsDist));
});

//将[{moduleName:MD5}]对照关系verMap写入requireConfig.js配置文件中(需要修改requirejs源码)
/*gulp.task("__modifyRequireConfig", ["__createMD5VerMap"], function () {
 return gulp.src(requireConfigJsOutputSrc)
 .pipe(through2.obj(function (file, encoding, done) {
 let configContents = file.contents.toString();
 configContents = configContents.replace("var urlArgVerMap = {}", "var urlArgVerMap = " + JSON.stringify(verMap));
 file.contents = new Buffer(configContents);
 this.push(file);
 done();
 }))
 .pipe(rename(requireConfigJsName))
 .pipe(gulp.dest(requireConfigJsDist));
 });*/

//清空打包目录
gulp.task("__clean", function () {
    return gulp.src('./dist').pipe(clean());
});

//主入口合并
gulp.task('__buildApp', function (done) {
    let promises = [];
    promises.push(new Promise(function (resolve) {
        //主入口
        __buildEntry("module-hive", "hive_home", "home", resolve);
    }));
    promises.push(new Promise(function (resolve) {
        //数据开发
        __buildEntry("module-hive", "hive_hiveData", "hiveData", resolve);
    }));
    promises.push(new Promise(function (resolve) {
        //数据订阅
        __buildEntry("module-task", "task_main", "main", resolve);
    }));
    promises.push(new Promise(function (resolve) {
        //自助报表
        __buildEntry("module-report", "report_main", "main", resolve);
    }));
    promises.push(new Promise(function (resolve) {
        //自助报表
        __buildEntry("module-report", "report_emailConfig", "emailConfig", resolve);
    }));
    promises.push(new Promise(function (resolve) {
        //自助报表
        __buildEntry("module-report", "report_reportConfig", "reportConfig", resolve);
    }));
    promises.push(new Promise(function (resolve) {
        //系统管理
        __buildEntry("module-system", "system_main", "main", resolve);
    }));
    Promise.all(promises).then(function () {
        done();
    })
});

//打包数据开发模块组件
gulp.task('__buildHive', function () {
    return gulp.src(["./module-hive/js/module/*.js"])
        .pipe(through2.obj(function (file, encoding, done) {
            let filename = file.relative.replace(".js", "");
            console.log(filename);
            console.log(file.path);
            __buildModules("module-hive", "hiveData_" + filename, filename, done);
        }))
});

//打包自助报表模块组件
gulp.task('__buildReport', function () {
    return gulp.src(["./module-report/js/module/*.js"])
        .pipe(through2.obj(function (file, encoding, done) {
            let filename = file.relative.replace(".js", "");
            console.log(filename);
            console.log(file.path);
            __buildModules("module-report", "report_" + filename, filename, done);
        }))
});

//打包系统管理模块组件
gulp.task('__buildSystem', function () {
    return gulp.src(["./module-system/js/module/*.js"])
        .pipe(through2.obj(function (file, encoding, done) {
            let filename = file.relative.replace(".js", "");
            console.log(filename);
            console.log(file.path);
            __buildModules("module-system", "system_" + filename, filename, done);
        }))
});

//打包数据订阅模块组件
gulp.task('__buildTask', function () {
    return gulp.src(["./module-task/js/module/*.js"])
        .pipe(through2.obj(function (file, encoding, done) {
            let filename = file.relative.replace(".js", "");
            console.log(filename);
            console.log(file.path);
            __buildModules("module-task", "task_" + filename, filename, done);
        }))
});

gulp.task('__components', function () {
    return gulp.src(["./components/*/*/*.js"])
        .pipe(through2.obj(function (file, encoding, done) {
            let match = /(.*?)[\\\/]?([^\\\/]+).js/.exec(file.relative);
            if (match) {
                let path = match[1];
                let filename = match[2];
                console.log(filename);
                console.log(file.path);
                __buildComponents(path, "components_" + filename, filename, done);
            }
        }))
});

//公共模块合并 数据订阅需调整
gulp.task('__buildCommModule', function () {
    return gulp.src(["./js/jquery.min.js", "./js/bootstrap-3.3.2/js/bootstrap.min.js", "js/comm.js"])
        .pipe(concat("club_common.js"))
        .pipe(uglify({
            mangle: {except: ["CommFunc"]}//排除混淆关键字
        }))
        .pipe(gulp.dest('./dist/js/'))
});

//模块合并
gulp.task('__buildModules', ["__buildHive", "__buildReport", "__buildSystem", "__buildTask", "__components"]);

//文件copy
gulp.task("__copyApp", ['__clean'], function () {
    return gulp.src([
        "./**",
        '!./config', '!./config/**',
        '!./mock', '!./mock/**',
        '!./node_modules', '!./node_modules/**',
        '!./site', '!./site/**',
        '!./test/*.*',
        '!./WEB-INF', '!./WEB-INF/**',
        "!gulpfile.js",
        "!package.json",
        "!readme.txt",
        "!test.html"
    ]).pipe(gulp.dest("./dist"))
});

//设置本地及测试环境相关配置
gulp.task('__setDevConfig', function () {
    return __buildRequireConfigJs('config/dev-config.js');
});

//设置运行环境相关配置
gulp.task('__setPrdConfig', function () {
    // optimize = "uglify2";
    root = "dist/";
    return __buildRequireConfigJs('config/prd-config.js');
});

//附加Mock配置
gulp.task('__setMockConfig', function () {
    return __buildRequireConfigJs("./config/mock-config.js", "./mock/**/*.js");
});

//附加Karma配置
gulp.task('__setKarmaConfig', function () {
    return __buildRequireConfigJs('config/mock-config.js', 'config/karma-config.js', './mock/**/*.js');
});

//对html中的script引入的js和link引入的css加MD5版本号
gulp.task('__rev-hash', function () {
    gulp.src('module-hive/*.html')
        .pipe(revHash({assetsDir: 'dist/module-hive'}))
        .pipe(gulp.dest('dist/module-hive'));

    gulp.src('module-report/*.html')
        .pipe(revHash({assetsDir: 'dist/module-report'}))
        .pipe(gulp.dest('dist/module-report'));

    gulp.src('module-task/*.html')
        .pipe(revHash({assetsDir: 'dist/module-task'}))
        .pipe(gulp.dest('dist/module-task'));

    gulp.src('module-system/*.html')
        .pipe(revHash({assetsDir: 'dist/module-system'}))
        .pipe(gulp.dest('dist/module-system'));
});

gulp.task('_webServer', function () {
    gulp.src('./')
        .pipe(webServer({
            // livereload: true,
            // directoryListing: true,
            port: 9000,
            open: "http://localhost:9000/app/index.html"
        }));
});

//构建Mock环境
gulp.task('build_mock', sequence(
    "__setDevConfig", "__modifyRequireConfig", "__setMockConfig", "_webServer"
));
gulp.task('_watchMock', function () {
    return gulpWatch("./mock/**/*.js", function () {
        gulp.run(["__setMockConfig"]);
    })
})
//运行karma测试
gulp.task('karma_start', ['__setKarmaConfig'], function (done) {
    new Server({
        configFile: __dirname + '/karma.conf.js',
        singleRun: true
    }, function (err) {
        if (err === 0) {
            done();
        } else {
            done(new Error('karma test failed.' + err));
        }
    }).start();
});

//构建本地及测试环境
gulp.task('build_dev', sequence(
    "__setDevConfig", "__modifyRequireConfig"
));

//构建运行环境
gulp.task('build_prd', sequence(
    "__setPrdConfig", "__copyApp", ["__buildApp", "__buildModules"], "__modifyRequireConfig", "__rev-hash"
));

//构建运行环境（基于karma测试结果）
gulp.task('build_prd_with_karma', sequence(
    "karma_start", "build_prd"
));