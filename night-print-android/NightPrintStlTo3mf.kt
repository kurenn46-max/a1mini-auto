package com.u1.slicer

import java.io.File
import java.io.FileInputStream
import java.io.OutputStreamWriter
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.Locale
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/**
 * Converts a raw STL to a material-bearing 3MF BEFORE native Orca slicing.
 * The pinned Bambu native path consumes 3MF filament data but seeds PLA
 * material when given a bare STL. We never rewrite executable G-code.
 * No network, printer access or automatic print actions.
 */
internal object NightPrintStlTo3mf {
    data class Settings(
        val filamentType: String,
        val nozzleC: Int,
        val bedC: Int,
        val wallLoops: Int,
        val fillDensityPercent: Int,
        val layerHeightMm: Float,
        val topLayers: Int,
        val bottomLayers: Int,
        val infillPattern: String,
    )

    private const val MAX_BYTES = 80L * 1024L * 1024L
    private const val MAX_FACETS = 300_000L
    private const val MAX_UNIQUE_VERTICES = 300_000

    // The V2.8 converter wrote independent vertex indices for every triangle.
    // Native Orca can interpret such a soup as disconnected surface faces,
    // producing missing 0.2mm layers and unsafe 1.2mm jumps on a simple ring.
    // Weld only BIT-IDENTICAL STL coordinates; no geometry is moved.
    private data class VertexKey(val xBits: Int, val yBits: Int, val zBits: Int) {
        fun values(): FloatArray = floatArrayOf(
            Float.fromBits(xBits), Float.fromBits(yBits), Float.fromBits(zBits))
    }

    private fun vertexKey(v: FloatArray): VertexKey = VertexKey(
        if (v[0] == 0f) 0 else v[0].toBits(),
        if (v[1] == 0f) 0 else v[1].toBits(),
        if (v[2] == 0f) 0 else v[2].toBits(),
    )
    private const val MODEL_NS = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"

    fun wrap(input: File, output: File, settings: Settings): File {
        require(input.isFile && input.length() in 84L..MAX_BYTES) {
            "STLが空か大きすぎます（最大80MB）。安全のため中止します。"
        }
        require(output.absolutePath != input.absolutePath) { "Output would overwrite original STL" }
        require(settings.filamentType.matches(Regex("[A-Za-z0-9_+.-]{2,24}"))) {
            "素材名が正しくありません。"
        }
        require(settings.nozzleC in 170..300 && settings.bedC in 0..80) {
            "ノズルまたはベッド温度が範囲外です。"
        }
        require(settings.wallLoops in 1..12 && settings.fillDensityPercent in 0..100 &&
            settings.topLayers in 0..20 && settings.bottomLayers in 0..20 &&
            settings.layerHeightMm in 0.08f..0.4f &&
            settings.infillPattern.matches(Regex("[A-Za-z0-9_]{3,32}"))) {
            "印刷設定が正しくありません。"
        }
        val binary = detectBinaryStl(input)
        val total = scanTriangles(input, binary) { _, _, _ -> }
        require(total in 4..MAX_FACETS) {
            "STLの三角形数が正しくありません（上限30万）。"
        }
        // Build a bounded, shared-vertex indexed mesh before writing XML.
        val uniqueVertices = LinkedHashMap<VertexKey, Int>()
        val vertexIds = IntArray(total.toInt() * 3)
        var triangleCount = 0
        val scanned = scanTriangles(input, binary) { a, b, c ->
            val offset = triangleCount * 3
            for ((j, point) in arrayOf(a, b, c).withIndex()) {
                val key = vertexKey(point)
                val id = uniqueVertices[key] ?: run {
                    require(uniqueVertices.size < MAX_UNIQUE_VERTICES) {
                        "STLの頂点数が上限を超えています。安全のため中止します。"
                    }
                    val newId = uniqueVertices.size
                    uniqueVertices[key] = newId
                    newId
                }
                vertexIds[offset + j] = id
            }
            triangleCount++
        }
        check(scanned == total && triangleCount == total.toInt()) {
            "STLが変換中に変更されました。"
        }
        for (i in 0 until triangleCount) {
            val o = i * 3
            require(vertexIds[o] != vertexIds[o + 1] &&
                vertexIds[o + 1] != vertexIds[o + 2] &&
                vertexIds[o] != vertexIds[o + 2]) {
                "STLに面積ゼロの三角形が含まれます。"
            }
        }

        output.parentFile?.mkdirs()
        val temp = File(output.parentFile, output.name + ".partial")
        temp.delete()
        try {
            ZipOutputStream(temp.outputStream().buffered()).use { zip ->
                zip.putNextEntry(ZipEntry("[Content_Types].xml"))
                zip.write(("""
                    <?xml version="1.0" encoding="UTF-8"?>
                    <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
                     <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
                     <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
                     <Default Extension="config" ContentType="application/octet-stream"/>
                    </Types>
                """).trimIndent().toByteArray(Charsets.UTF_8))
                zip.closeEntry()

                zip.putNextEntry(ZipEntry("_rels/.rels"))
                zip.write(("""
                    <?xml version="1.0" encoding="UTF-8"?>
                    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
                     <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
                    </Relationships>
                """).trimIndent().toByteArray(Charsets.UTF_8))
                zip.closeEntry()

                zip.putNextEntry(ZipEntry("3D/3dmodel.model"))
                val xml = OutputStreamWriter(zip, Charsets.UTF_8)
                xml.write("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n")
                xml.write("<model xmlns=\"")
                xml.write(MODEL_NS)
                xml.write("\" unit=\"millimeter\" xml:lang=\"en-US\">")
                xml.write("<resources><object id=\"1\" type=\"model\" name=\"NIGHT PRINT STL\"><mesh><vertices>")
                // A shared vertex table is essential for manifold 3MF topology.
                for (key in uniqueVertices.keys) {
                    val v = key.values()
                    xml.write("<vertex x=\\"" + v[0] + "\\" y=\\"" + v[1] +
                        "\\" z=\\"" + v[2] + "\\"/>")
                }
                xml.write("</vertices><triangles>")
                for (i in 0 until triangleCount) {
                    val o = 3 * i
                    xml.write("<triangle v1=\\"" + vertexIds[o] +
                        "\\" v2=\\"" + vertexIds[o + 1] +
                        "\\" v3=\\"" + vertexIds[o + 2] + "\\"/>")
                }
                xml.write("</triangles></mesh></object></resources><build><item objectid=\"1\"/></build></model>")
                xml.flush()
                zip.closeEntry()

                zip.putNextEntry(ZipEntry("Metadata/project_settings.config"))
                val mat = settings.filamentType.uppercase(Locale.ROOT)
                val layer = settings.layerHeightMm.toString()
                val json = """{
                  "filament_type":["$mat"],
                  "filament_colour":["#888888"],
                  "nozzle_temperature":["${settings.nozzleC}"],
                  "nozzle_temperature_initial_layer":["${settings.nozzleC}"],
                  "hot_plate_temp":["${settings.bedC}"],
                  "hot_plate_temp_initial_layer":["${settings.bedC}"],
                  "textured_plate_temp":["${settings.bedC}"],
                  "textured_plate_temp_initial_layer":["${settings.bedC}"],
                  "filament_flow_ratio":["0.98"],
                  "filament_max_volumetric_speed":["2"],
                  "curr_bed_type":"Textured PEI Plate",
                  "layer_height":"$layer",
                  "initial_layer_print_height":"$layer",
                  "wall_loops":"${settings.wallLoops}",
                  "top_shell_layers":"${settings.topLayers}",
                  "bottom_shell_layers":"${settings.bottomLayers}",
                  "sparse_infill_density":"${settings.fillDensityPercent}%",
                  "sparse_infill_pattern":"${settings.infillPattern}"
                }"""
                zip.write(json.toByteArray(Charsets.UTF_8))
                zip.closeEntry()
            }
            require(temp.length() > 500L) { "3MFの生成に失敗しました。" }
            if (output.exists() && !output.delete()) throw IllegalStateException("古い3MFを削除できません。")
            require(temp.renameTo(output)) { "3MFを確定できません。" }
            return output
        } finally {
            temp.delete()
        }
    }

    private fun detectBinaryStl(file: File): Boolean {
        if (file.length() < 84L) return false
        RandomAccessFile(file, "r").use { raf ->
            raf.seek(80L)
            val bytes = ByteArray(4)
            raf.readFully(bytes)
            val count = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).int.toLong() and 0xffffffffL
            if (file.length() == 84L + count * 50L) return true
        }
        FileInputStream(file).use { input ->
            val prefix = ByteArray(5)
            require(input.read(prefix) == 5 && String(prefix, Charsets.US_ASCII)
                .equals("solid", ignoreCase = true)) { "STLの形式を認識できません。" }
        }
        return false
    }

    private fun validatedPoint(x: Float, y: Float, z: Float): FloatArray {
        require(x.isFinite() && y.isFinite() && z.isFinite() &&
            kotlin.math.abs(x) <= 1_000_000f &&
            kotlin.math.abs(y) <= 1_000_000f &&
            kotlin.math.abs(z) <= 1_000_000f) { "STLに不正な座標が含まれます。" }
        return floatArrayOf(x, y, z)
    }

    private fun scanTriangles(
        file: File, binary: Boolean,
        visit: (FloatArray, FloatArray, FloatArray) -> Unit,
    ): Long {
        var triangles = 0L
        if (binary) {
            RandomAccessFile(file, "r").use { raf ->
                raf.seek(80L)
                val countBuffer = ByteArray(4)
                raf.readFully(countBuffer)
                val count = ByteBuffer.wrap(countBuffer).order(ByteOrder.LITTLE_ENDIAN)
                    .int.toLong() and 0xffffffffL
                require(count in 1..MAX_FACETS) { "STLの三角形数が上限を超えています。" }
                val facet = ByteArray(50)
                val buf = ByteBuffer.wrap(facet).order(ByteOrder.LITTLE_ENDIAN)
                repeat(count.toInt()) {
                    raf.readFully(facet)
                    buf.position(12)
                    val a = validatedPoint(buf.float, buf.float, buf.float)
                    val b = validatedPoint(buf.float, buf.float, buf.float)
                    val c = validatedPoint(buf.float, buf.float, buf.float)
                    visit(a, b, c)
                    triangles++
                }
            }
        } else {
            val points = ArrayList<FloatArray>(3)
            file.bufferedReader(Charsets.US_ASCII).useLines { lines ->
                lines.forEach { original ->
                    val line = original.trim()
                    if (!line.startsWith("vertex ", ignoreCase = true)) return@forEach
                    val coords = line.split(Regex("\\s+"))
                    require(coords.size == 4) { "ASCII STLの頂点データが不正です。" }
                    val a = coords[1].toFloatOrNull() ?: error("STLのX座標が不正です。")
                    val b = coords[2].toFloatOrNull() ?: error("STLのY座標が不正です。")
                    val c = coords[3].toFloatOrNull() ?: error("STLのZ座標が不正です。")
                    points.add(validatedPoint(a,b,c))
                    if (points.size == 3) {
                        visit(points[0], points[1], points[2])
                        points.clear()
                        triangles++
                        require(triangles <= MAX_FACETS) { "STLが大きすぎます。" }
                    }
                }
            }
            require(points.isEmpty()) { "ASCII STLの頂点数が3の倍数ではありません。" }
        }
        return triangles
    }
}
