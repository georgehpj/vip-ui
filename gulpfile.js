"use strict";
const gulp = require("gulp");
const sass = require('gulp-sass');

gulp.task('_buildScss', function () {
    gulp.src('./src/stylesheets/vip-ui.scss')
        .pipe(sass().on('error', sass.logError))
        .pipe(gulp.dest('./src/stylesheets/'));
});

//在命令行执行：gulp sass:watch，就可实现监听文件变化来自动编译
gulp.task('scssWatcher', function () {
    gulp.watch('./src/stylesheets/**/*.scss', ["_buildScss"]);
});
