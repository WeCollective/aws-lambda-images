module.exports = grunt => {
  // Load tasks.
  grunt.loadNpmTasks('grunt-contrib-jshint');
  grunt.loadNpmTasks('grunt-exec');
  grunt.loadNpmTasks('grunt-zip');

  // Configure tasks,
  grunt.initConfig({
    jshint: {
      files: [
        'Gruntfile.js',
        'Images.js',
      ],
      options: {
        esversion: 6,
        // Use Node to avoid incorrect errors,
        node: true,
      },
    },
    // execute shell commands
    exec: {
      publish: 'git checkout production && git merge master && git checkout master',
      checkout: {
        cmd(env) {
          let checkout;

          if (env === 'dev') {
            checkout = 'master';
          }
          else if (env === 'production') {
            checkout = 'production';
          }
          else {
            return '';
          }

          return `echo Checking out ${checkout} && git checkout ${checkout}`;
        },
      },
      deploy: {
        cmd(env) {
          let checkout;
          let functionName;

          if (env === 'dev') {
            checkout = 'master';
            functionName = 'devImages';
          }
          else if (env === 'production') {
            checkout = 'production';
            functionName = 'Images';
          }
          else {
            return '';
          }

          const deployCommand = `aws lambda update-function-code --function-name ${functionName} --zip-file fileb://Images.zip --region eu-west-1 --profile weco-iam`;
          return `echo Checking out ${checkout} && git checkout ${checkout} && echo Deploying... && ${deployCommand} && git checkout master`;
        },
      },
    },
    zip: {
      'Images.zip': [
        'Images.js',
        'node_modules/**/*',
      ],
    },
  });

  // Register tasks.
  grunt.registerTask('build:dev', ['exec:checkout:dev', 'jshint', 'zip']);
  grunt.registerTask('build:production', ['exec:publish', 'exec:checkout:production', 'jshint', 'zip']);
  grunt.registerTask('deploy:dev', ['build:dev', 'exec:deploy:dev']);
  grunt.registerTask('deploy:production', ['build:production', 'exec:deploy:production']);
};
