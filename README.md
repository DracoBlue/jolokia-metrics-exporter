# jolokia-metrics-exporter

This project is similar to the official prometheus jmx_exporter from https://github.com/prometheus/jmx_exporter but does
support fetching data from an external jolokia endpoint.

## Usage

To make jolokia-metrics-exporter work, you will need 4 environment variables set and a config.yaml at
`/usr/src/app/config.yaml` or any other location, which you can set via the `CONFIG_YAML` environment variable.

The `.env`:

```
JOLOKIA_URL=http://example.org/jolokia
USERNAME=admin
PASSWORD=admin
CONFIG_YML=/usr/src/app/config.yaml
```

If you want to use docker-compose.yml to try it, use:

```yaml
version: "2.0"
services:
  jolokia-metrics-exporter:
    image: dracoblue/jolokia-metrics-exporter
    env_file:
      - .env
    volumes:
      - './config.yaml:/usr/src/app/config.yaml'
    ports:
      - "9442:9442"
```

## Example config.yaml

This file should work for most JVM installations and expose the values properly as metrics:

```yaml
  - pattern: java.lang<type=Threading><>(.+ThreadCount)
    name: java_lang_threading$1
    attrNameSnakeCase: true
    type: GAUGE
    help: Java's $1
  - pattern: java.lang<type=Threading><>(.+ThreadCount)
    name: java_lang_threading_thread_count
    attrNameSnakeCase: true
    type: GAUGE
    labels:
      $1: $0
    help: Java's $1
  - pattern: java.lang<type=Memory><>HeapMemoryUsage/(.+)
    name: java_lang_heap_memory_usage_$1
    attrNameSnakeCase: true
    type: GAUGE
    help: Heap memory $1 usage
  - pattern: java.lang<type=Runtime><>SpecVersion
    name: java_lang_runtime_spec_version
    value: 1
    labels:
      "version": $0
    type: GAUGE
  - pattern: java.lang<name=PS Scavenge,type=GarbageCollector><>(CollectionCount|CollectionTime)
    name: java_lang_garbage_collector$1
    attrNameSnakeCase: true
    filter:
      Name: "PS Scavenge"
    type: GAUGE
    help: Index Queue Size
```

will give you an endpoint exposing the metrics, like this:

```text
# HELP java_lang_threading_total_started_thread_count Java's TotalStartedThreadCount
# TYPE java_lang_threading_total_started_thread_count gauge
java_lang_threading_total_started_thread_count 22139
# HELP java_lang_threading_peak_thread_count Java's PeakThreadCount
# TYPE java_lang_threading_peak_thread_count gauge
java_lang_threading_peak_thread_count 154
# HELP java_lang_threading_daemon_thread_count Java's DaemonThreadCount
# TYPE java_lang_threading_daemon_thread_count gauge
java_lang_threading_daemon_thread_count 88
# HELP java_lang_threading_thread_count Java's TotalStartedThreadCount
# TYPE java_lang_threading_thread_count gauge
java_lang_threading_thread_count{TotalStartedThreadCount="22139"} 22139
java_lang_threading_thread_count{PeakThreadCount="154"} 154
java_lang_threading_thread_count{DaemonThreadCount="88"} 88
# HELP java_lang_heap_memory_usage_init Heap memory init usage
# TYPE java_lang_heap_memory_usage_init gauge
java_lang_heap_memory_usage_init 494927872
# HELP java_lang_heap_memory_usage_committed Heap memory committed usage
# TYPE java_lang_heap_memory_usage_committed gauge
java_lang_heap_memory_usage_committed 6716129280
# HELP java_lang_heap_memory_usage_max Heap memory max usage
# TYPE java_lang_heap_memory_usage_max gauge
java_lang_heap_memory_usage_max 9544663040
# HELP java_lang_heap_memory_usage_used Heap memory used usage
# TYPE java_lang_heap_memory_usage_used gauge
java_lang_heap_memory_usage_used 3754287416
# TYPE java_lang_runtime_spec_version gauge
java_lang_runtime_spec_version{version="1.8"} 1
# HELP java_lang_garbage_collector_collection_time Index Queue Size
# TYPE java_lang_garbage_collector_collection_time gauge
java_lang_garbage_collector_collection_time 408073
# HELP java_lang_garbage_collector_collection_count Index Queue Size
# TYPE java_lang_garbage_collector_collection_count gauge
```

## Related projects

* [jmx_exporter](https://github.com/prometheus/jmx_exporter)
  - requires exposed RMI port
  - no jolokia support
  - doesn't allow overriding value for 1 in case of e.g. app version
  - doesn't allow to filter a list
* [jolokia_exporter](https://github.com/Scalify/jolokia_exporter) 
  - no label support
  - doesn't allow overriding value for 1 in case of e.g. app version
  - doesn't allow setting type of targets
  - doesn't allow to filter a list 

## License

This work is copyright by DracoBlue (http://dracoblue.net) and licensed under the terms of MIT License.
